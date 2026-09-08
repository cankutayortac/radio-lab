'use client';
import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import { AIDS, destination, type Aircraft, type Point } from '@/lib/navigation';
import { fixPoint, type Mission } from '@/lib/training';
import 'leaflet/dist/leaflet.css';

export function TrainerMap({
  ac,
  trail,
  mission,
  guide,
  follow,
  recenter,
  canPlace,
  onPlace,
}: {
  ac: Aircraft;
  trail: Point[];
  mission: Mission | null;
  guide: boolean;
  follow: boolean;
  recenter: number;
  canPlace: boolean;
  onPlace: (p: Point) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    map = useRef<Leaflet.Map | null>(null),
    layers = useRef<{
      plane: Leaflet.Marker;
      trail: Leaflet.Polyline;
      guides: Leaflet.LayerGroup;
      L: typeof Leaflet;
    } | null>(null);
  const current = useRef({ ac, canPlace, onPlace });
  useEffect(() => {
    current.current = { ac, canPlace, onPlace };
  }, [ac, canPlace, onPlace]);
  const [ready, setReady] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false,
      observer: ResizeObserver | undefined;
    void import('leaflet')
      .then((L) => {
        if (cancelled || !host.current) return;
        const m = L.map(host.current, {
          zoomControl: true,
          attributionControl: true,
        }).setView([current.current.ac.lat, current.current.ac.lon], 10);
        map.current = m;
        const tile = L.tileLayer(
          'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
          {
            maxZoom: 16,
            attribution:
              '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
        ).addTo(m);
        tile.on('tileerror', () => {
          if (!cancelled)
            setError(
              'Harita döşemeleri yüklenemedi. İnternet bağlantını kontrol et; uçuş ve göstergeler çalışmaya devam eder.',
            );
        });
        tile.on('load', () => {
          if (!cancelled) setError('');
        });
        L.control.scale({ imperial: false }).addTo(m);
        for (const s of AIDS) {
          const symbol =
            s.type === 'NDB'
              ? '<circle cx="18" cy="18" r="12" fill="none" stroke-dasharray="2 2"/><circle cx="18" cy="18" r="5" fill="none"/>'
              : '<path d="M18 4L30 11V25L18 32L6 25V11Z" fill="none"/><path d="M10 18H26M18 10V26"/>';
          const icon = L.divIcon({
            className: 'station-marker',
            html: `<svg viewBox="0 0 36 36" width="36" height="36" stroke="${s.type === 'NDB' ? '#9a4f06' : '#254a85'}" stroke-width="2"><circle cx="18" cy="18" r="16" fill="#faf7ee" stroke="none"/>${symbol}</svg><b>${s.id}</b><small>${s.type === 'NDB' ? s.freq : s.freq.toFixed(2)}</small>`,
            iconSize: [64, 64],
            iconAnchor: [32, 18],
          });
          L.marker([s.lat, s.lon], { icon })
            .addTo(m)
            .bindPopup(
              `<b>${s.id} · ${s.name}</b><br>${s.type} · ${s.freq} ${s.type === 'NDB' ? 'kHz' : 'MHz'}<br>Eğitim senaryosu verisi`,
            );
        }
        const icon = L.divIcon({
          className: 'aircraft-marker',
          html: '<svg viewBox="0 0 48 48" width="44" height="44"><path d="M24 3L28 19L43 28V32L28 28L27 39L33 43V46L24 43L15 46V43L21 39L20 28L5 32V28L20 19Z" fill="#fff" stroke="#133e55" stroke-width="2"/></svg>',
          iconSize: [44, 44],
          iconAnchor: [22, 22],
        });
        const plane = L.marker(
          [current.current.ac.lat, current.current.ac.lon],
          { icon, zIndexOffset: 1000, interactive: false },
        ).addTo(m);
        layers.current = {
          L,
          plane,
          trail: L.polyline([], {
            color: '#007c87',
            weight: 3,
            opacity: 0.8,
          }).addTo(m),
          guides: L.layerGroup().addTo(m),
        };
        m.on('click', (e: Leaflet.LeafletMouseEvent) => {
          if (current.current.canPlace)
            current.current.onPlace({ lat: e.latlng.lat, lon: e.latlng.lng });
        });
        observer = new ResizeObserver(() => m.invalidateSize());
        observer.observe(host.current);
        setReady(true);
      })
      .catch(() => setError('Harita başlatılamadı. Sayfayı yenileyebilirsin.'));
    return () => {
      cancelled = true;
      observer?.disconnect();
      map.current?.remove();
      map.current = null;
      layers.current = null;
    };
  }, []);
  useEffect(() => {
    if (!ready || !layers.current) return;
    layers.current.plane.setLatLng([ac.lat, ac.lon]);
    const svg = layers.current.plane.getElement()?.querySelector('svg');
    if (svg) svg.style.transform = `rotate(${ac.heading + 6}deg)`;
    layers.current.trail.setLatLngs(
      trail.map((p): [number, number] => [p.lat, p.lon]),
    );
    if (
      follow &&
      map.current &&
      !map.current.getBounds().pad(-0.25).contains([ac.lat, ac.lon])
    )
      map.current.panTo([ac.lat, ac.lon], { animate: false });
  }, [ac, trail, follow, ready]);
  useEffect(() => {
    if (ready)
      map.current?.panTo([current.current.ac.lat, current.current.ac.lon], {
        animate: false,
      });
  }, [recenter, ready]);
  useEffect(() => {
    const layersNow = layers.current;
    if (!ready || !layersNow) return;
    const { L, guides } = layersNow;
    guides.clearLayers();
    if (!guide || !mission) return;
    const s = AIDS[mission.station];
    if (mission.kind === 'arc') {
      const points = Array.from({ length: 73 }, (_, i) =>
        destination(s, i * 5 + s.declination, 9.98),
      );
      L.polyline(
        points.map((p): [number, number] => [p.lat, p.lon]),
        { color: '#96553c', weight: 2, dashArray: '6 6' },
      ).addTo(guides);
    } else {
      const p = destination(s, mission.course + s.declination, 28),
        q = destination(s, mission.course + s.declination + 180, 28);
      L.polyline(
        [
          [p.lat, p.lon],
          [s.lat, s.lon],
          [q.lat, q.lon],
        ],
        { color: '#895174', weight: 2, dashArray: '6 6' },
      ).addTo(guides);
    }
    if (mission.kind === 'fix') {
      L.polyline(
        [
          [AIDS[1].lat, AIDS[1].lon],
          [fixPoint.lat, fixPoint.lon],
        ],
        { color: '#895174', weight: 2, dashArray: '6 6' },
      ).addTo(guides);
      L.circleMarker([fixPoint.lat, fixPoint.lon], {
        color: '#895174',
        radius: 8,
        fillOpacity: 0.2,
      })
        .bindTooltip('Eğitim fiksi')
        .addTo(guides);
    }
  }, [mission, guide, ready]);
  return (
    <>
      <div
        ref={host}
        className="map-canvas"
        aria-label="İstanbul çevresi seyrüsefer çalışma haritası"
      />
      {error && <output className="map-error">{error}</output>}
    </>
  );
}
