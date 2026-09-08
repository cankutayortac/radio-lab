import { useId } from 'react';
import { fmt, norm, type Aircraft, type Reception } from '@/lib/navigation';

export type BearingSource = 'NAV1' | 'NAV2' | 'ADF' | 'OFF';
function BearingNeedle({ double, angle }: { double: boolean; angle: number }) {
  return (
    <g
      transform={`rotate(${angle})`}
      fill="none"
      stroke="#43e8ef"
      strokeWidth="2.5"
      strokeLinejoin="miter"
    >
      {double ? (
        <>
          <path d="M-4 -104V-139L0 -144L4 -139V-104 M-14 -130L0 -144L14 -130 M0 -144V-149" />
          <path d="M-4 104V142H4V104 M0 142V149" />
        </>
      ) : (
        <>
          <path d="M0 -104V-149 M-14 -131L0 -145L14 -131" />
          <path d="M0 104V149" />
        </>
      )}
    </g>
  );
}
function BearingWindow({
  x,
  source,
  r,
  double,
}: {
  x: number;
  source: BearingSource;
  r: Reception;
  double: boolean;
}) {
  const valid = source !== 'OFF' && r?.valid;
  return (
    <g className="svg-bearing-window" transform={`translate(${x},451)`}>
      <path d="M0 0H181V78H0Z" fill="#161e22" stroke="#515c61" />
      <g
        transform="translate(15 17)"
        stroke="#43e8ef"
        fill="none"
        strokeWidth="1.8"
      >
        {double ? (
          <path d="M0 -2H18V-6L26 0L18 6V2H0Z" />
        ) : (
          <path d="M0 0H26M20 -5L26 0L20 5" />
        )}
      </g>
      <text x="49" y="23" fill="#43e8ef" fontSize="17">
        {source}
      </text>
      <text x="165" y="23" textAnchor="end" fill="white" fontSize="17">
        {source === 'OFF' ? '' : r?.inRange ? r.station.id : '—'}
      </text>
      <text x="13" y="47" fill="#aab7c0" fontSize="12">
        {double ? 'BRG 2' : 'BRG 1'}
      </text>
      <text x="165" y="47" textAnchor="end" fill="white" fontSize="18">
        {valid ? `${fmt(r.bearing)}°` : '— — —'}
      </text>
      <text x="13" y="68" fill="#aab7c0" fontSize="12">
        DME
      </text>
      <text x="165" y="68" textAnchor="end" fill="white" fontSize="18">
        {source !== 'OFF' && r?.dme != null
          ? `${r.dme.toFixed(1)} NM`
          : '— — . —'}
      </text>
    </g>
  );
}
export function TrainerHSI({
  ac,
  course,
  bug,
  nav,
  navIndex,
  b1,
  b2,
  s1,
  s2,
  hideGuidance = false,
}: {
  ac: Aircraft;
  course: number;
  bug: number;
  nav: Reception;
  navIndex: number;
  b1: Reception;
  b2: Reception;
  s1: BearingSource;
  s2: BearingSource;
  hideGuidance?: boolean;
}) {
  const green = '#66ff66',
    valid = !!nav?.valid;
  const gradientId = useId();
  return (
    <div className="hsi-assembly">
      <div className="hsi-viewport">
        <svg
          className="hsi"
          viewBox="0 0 640 542"
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- An accessible generated SVG must retain its image semantics.
          role="img"
          aria-label={`HSI. Baş ${fmt(ac.heading)}, course ${fmt(course)}. VOR${navIndex}. ${valid ? `${nav.flag}${hideGuidance ? '' : `, CDI ${nav.error.toFixed(1)} derece`}` : 'Seyrüsefer sinyali geçersiz'}`}
        >
          <defs>
            <radialGradient id={gradientId}>
              <stop stopColor="#263338" />
              <stop offset="1" stopColor="#10171b" />
            </radialGradient>
          </defs>
          <rect width="640" height="542" rx="6" fill={`url(#${gradientId})`} />
          <text x="20" y="30" fill="#aab7c0" fontSize="14">
            HDG
          </text>
          <text x="65" y="30" fill="#43e8ef" fontSize="21">
            {fmt(bug)}°
          </text>
          <text x="518" y="30" fill="#aab7c0" fontSize="14">
            CRS
          </text>
          <text x="563" y="30" fill={green} fontSize="21">
            {fmt(course)}°
          </text>
          <g transform="translate(320 253)">
            <circle r="178" fill="#192226" />
            {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
              <path
                key={a}
                transform={`rotate(${a})`}
                d="M0 -189V-200"
                stroke="white"
                strokeWidth="3"
              />
            ))}
            <g transform={`rotate(${-ac.heading})`}>
              {Array.from({ length: 72 }, (_, i) => {
                const a = i * 5;
                return (
                  <g key={a} transform={`rotate(${a})`}>
                    <path
                      d={`M0 -178V${a % 10 === 0 ? -162 : -170}`}
                      stroke="#f8fafb"
                      strokeWidth={a % 30 === 0 ? 3 : 2}
                    />
                    {a % 30 === 0 && (
                      <text
                        y="-137"
                        textAnchor="middle"
                        fill="white"
                        fontSize={a % 90 === 0 ? 25 : 23}
                        fontWeight="500"
                      >
                        {a === 0
                          ? 'N'
                          : a === 90
                            ? 'E'
                            : a === 180
                              ? 'S'
                              : a === 270
                                ? 'W'
                                : a / 10}
                      </text>
                    )}
                  </g>
                );
              })}
              <path
                transform={`rotate(${bug})`}
                d="M-10 -183H-4L0 -175L4 -183H10V-168H-10Z"
                fill="#43e8ef"
              />
              <path
                transform={`rotate(${ac.track})`}
                d="M0 -164L5 -156L0 -148L-5 -156Z"
                fill="#df82f6"
                stroke="#10171b"
              />
            </g>
            {s1 !== 'OFF' && b1?.valid && (
              <BearingNeedle
                double={false}
                angle={norm(b1.bearing - ac.heading)}
              />
            )}
            {s2 !== 'OFF' && b2?.valid && (
              <BearingNeedle double angle={norm(b2.bearing - ac.heading)} />
            )}
            {(s1 !== 'OFF' || s2 !== 'OFF') && (
              <circle r="102" fill="none" stroke="white" strokeWidth="1.5" />
            )}
            <g transform={`rotate(${course - ac.heading})`}>
              {navIndex === 1 ? (
                <>
                  <path d="M0 -161L-10 -145H-3V-82H3V-145H10Z" fill={green} />
                  <path d="M0 83V165" stroke={green} strokeWidth="5" />
                </>
              ) : (
                <>
                  <path
                    d="M-3 -82V-144H-11L0 -162L11 -144H3V-82 M-3 82V164H3V82"
                    fill="none"
                    stroke={green}
                    strokeWidth="2.5"
                  />
                </>
              )}
              {[-74, -37, 37, 74].map((x) => (
                <circle
                  key={x}
                  cx={x}
                  r="4.6"
                  fill="none"
                  stroke="white"
                  strokeWidth="1.7"
                />
              ))}
              {valid && (
                <>
                  {navIndex === 1 ? (
                    <path
                      d={`M${nav.cdi * 74} -60V60`}
                      stroke={green}
                      strokeWidth="5"
                    />
                  ) : (
                    <rect
                      x={nav.cdi * 74 - 3}
                      y={-60}
                      width={6}
                      height={120}
                      fill="none"
                      stroke={green}
                      strokeWidth="2"
                    />
                  )}
                  {nav.flag !== 'OFF' && (
                    <path
                      d={
                        nav.flag === 'TO'
                          ? 'M0 -81L-8 -67H8Z'
                          : 'M0 81L-8 67H8Z'
                      }
                      fill={green}
                    />
                  )}
                </>
              )}
            </g>
            <text x="-83" y="-38" fill={green} fontSize="18" fontWeight="600">
              VOR{navIndex}
            </text>
            <text x="82" y="-38" textAnchor="end" fill={green} fontSize="14">
              {valid ? nav.flag : ''}
            </text>
            {!valid && (
              <g>
                <rect x="-42" y="28" width="84" height="24" fill="#17191b" />
                <text y="46" textAnchor="middle" fill="#ffb658" fontSize="17">
                  NAV
                </text>
                <path
                  d="M-20 29L20 50M20 29L-20 50"
                  stroke="#e65751"
                  strokeWidth="2"
                />
              </g>
            )}
            <path
              d="M0 -15V18M-23 -1H23M-10 17H10"
              fill="none"
              stroke="#10171b"
              strokeWidth="8"
            />
            <path
              d="M0 -15V18M-23 -1H23M-10 17H10"
              fill="none"
              stroke="white"
              strokeWidth="4"
            />
            <path d="M-7 -184L0 -171L7 -184Z" fill="white" />
          </g>
          <path
            d="M277 43H363V78H331L320 92L309 78H277Z"
            fill="#10171b"
            stroke="#adbbc1"
            strokeWidth="1.5"
          />
          <text
            x="320"
            y="69"
            textAnchor="middle"
            fill="white"
            fontSize="27"
            fontWeight="600"
          >
            {fmt(ac.heading)}°
          </text>
          <BearingWindow x={16} source={s1} r={b1} double={false} />
          <BearingWindow x={443} source={s2} r={b2} double />
          <text
            x="320"
            y="477"
            textAnchor="middle"
            fill="#aab7c0"
            fontSize="13"
          >
            {valid
              ? nav.station.id
              : nav?.overhead
                ? 'İSTASYON ÜZERİ'
                : 'SİNYAL YOK'}
          </text>
          <text
            x="320"
            y="500"
            textAnchor="middle"
            fill={valid ? green : '#ffb658'}
            fontSize="17"
          >
            {valid
              ? hideGuidance
                ? 'VOR'
                : `${Math.abs(nav.error).toFixed(1)}° sapma`
              : 'NAV geçersiz'}
          </text>
          <text
            x="320"
            y="522"
            textAnchor="middle"
            fill="#7f939d"
            fontSize="12"
          >
            VOR · ±10° tam ölçek
          </text>
        </svg>
      </div>
      <div className="mobile-bearing-windows">
        {[
          { source: s1, r: b1 },
          { source: s2, r: b2 },
        ].map(({ source, r }, i) => (
          <div
            className="mobile-bearing"
            key={i}
            aria-label={`Bearing ${i + 1} bilgisi`}
          >
            <div>
              <span className="cyan">
                BRG {i + 1} · {source}
              </span>
              <strong>
                {source === 'OFF' ? '—' : r?.inRange ? r.station.id : '—'}
              </strong>
            </div>
            <div>
              <svg
                width="28"
                height="14"
                viewBox="0 -7 28 14"
                fill="none"
                stroke="#43e8ef"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                {i === 0 ? (
                  <path d="M0 0H26M20 -5L26 0L20 5" />
                ) : (
                  <path d="M0 -2H18V-6L26 0L18 6V2H0Z" />
                )}
              </svg>
              <b>
                {source !== 'OFF' && r?.valid ? `${fmt(r.bearing)}°` : '— — —'}
              </b>
            </div>
            <div>
              <span>DME</span>
              <b>
                {source !== 'OFF' && r?.dme != null
                  ? `${r.dme.toFixed(1)} NM`
                  : '— — . —'}
              </b>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
