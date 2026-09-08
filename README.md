# Radio Lab

VOR, NDB ve DME çalışmaları için Türkçe, tarayıcı tabanlı yatay seyrüsefer eğitmeni. Bilgisayar, tablet ve telefonda çalışır. Sunucu, hesap veya API anahtarı gerektirmeyen GitHub Pages sürümü içerir.

## İçerik

- 8 ders, 24 açıklamalı bilgi sorusu ve 7 değerlendirilen uçuş görevi.
- Tek HSI üzerinde NAV1/NAV2 course/CDI, farklı BRG1/BRG2 ibreleri ve ADF.
- Aktif/standby frekans ayarı, mors kimliği, course/heading sliderları.
- Küresel yatay geometri, rüzgâr, koordineli dönüş ve DME eğik mesafesi.
- Rehberli/sınav modları; uçuş geçmişi yalnız kullanılan tarayıcıda saklanır.
- Tüm ekranlarda Kokpit / Harita / Görevler çalışma alanları; bilgisayarda HSI ve harita yan yana.
- Telefon ve tablette alt gezinme, büyük dokunma alanları ve kesintiye dayanıklı sliderlar.

## Yeni uçuş masası

1. **Görevler** sekmesinden bir brifing seçin; ders ve görev numaraları birbirinden ayrıdır.
2. Görevi yükleyin. Standby frekanslarını girip ↔ ile aktif yapın; CDI kaynağını ve CRS değerini ayarlayın.
3. Uçuşu başlatın. HDG uçağın başını kumanda eder; CRS yalnızca seçili yolu değiştirir.
4. Uçuşu bitirerek değerlendirmeyi açın. Derslerden ilgili görev brifingine geçebilirsiniz; devam eden bir uçuş bu geçişte sıfırlanmaz.

Bilgi testi yanıtları ders/kokpit sekmelerine gidip dönünce korunur; yeni test başlatmak veya sayfayı yenilemek mevcut test oturumunu sıfırlar. Tamamlanmış sonuçlar tarayıcı kaydında tutulur. Ekran boyutu değişirken sürükleme iptal edilir; seçili course ve heading kendiliğinden eşlenmez.

## Yerelde çalıştırma

Node.js 24 LTS ve npm kullanın:

```sh
npm ci
npm run dev:pages
```

Üretim çıktısı ve testler:

```sh
npm test
npm run build:pages
npm run preview:pages
```

Statik dosyalar `dist-pages/` içine üretilir. Bu klasör herhangi bir statik web sunucusunda yayımlanabilir. Harita döşemeleri için internet bağlantısı gerekir; tam çevrimdışı kullanım sunulmaz.

## GitHub Pages

Depoda **Settings → Pages → Build and deployment → Source → GitHub Actions** seçilir. `main` dalına gönderilen değişiklikler `.github/workflows/pages.yml` üzerinden test edilip yayımlanır. Gerekirse **Actions → Publish Radio Lab → Run workflow** ile başlatılır. Workflow depo alt yolunu otomatik ayarlar; özel token veya API anahtarı gerekmez. Son site adresi Actions dağıtım sonucunda ve Pages ayarlarında gösterilir.

## Telefon ve tablet

Kokpit görünümünde HSI, frekanslar ve baş/course kontrolleri; Harita görünümünde uçuş izi; Görev görünümünde brifing ve değerlendirme bulunur. Dönüş düğmelerine basılı tutun, bırakınca mevcut baş seçilir. Bir dereceyi doğrudan yazmak için sayı alanını düzenleyip Bitti/Enter tuşuna basın veya alan dışına dokunun. Ekran döndürülebilir; yakınlaştırma engellenmez. Bilgisayarda boşluk duraklatır, sol/sağ oklar geçici yatış verir. Sekme arka plana geçince uçuş duraklatılır.

## Eğitim kaynakları ve sınırlar

Kullanıcının sağladığı Efe Can Birinci v2 Rev01 notları ile IFR.PDF eğitim dokümanı temel alınarak özgün Türkçe ders ve sorular hazırlanmıştır. Kaynak PDF dosyaları ve chart görselleri bu depoya dahil değildir; uygulamada PDF sayfa referansları verilir.

HSI geometrisi Garmin'in resmi G1000/NXi kılavuzlarından incelenmiştir. Bu proje Garmin ürünü değildir; sertifikalı bir simülatör veya operasyonel seyrüsefer kaynağı değildir. Gerçek G1000 ayrı DME penceresi kullanabilir; burada eğitim tercihi olarak DME ilgili bearing altında gösterilir. Harita OpenStreetMap'tir, resmî yaklaşma chartı değildir. Sabit 120 KTAS, 4.200 ft MSL, 6°E senaryo varyasyonu ve basitleştirilmiş sinyal modeli kullanılır. Dikey yaklaşma, ILS ve otomatik puanlanan tam holding kapsam dışıdır. Ayrıntılar uygulamanın Kaynaklar bölümündedir.

İstasyon verileri dondurulmuş senaryo verileridir. Gerçek uçuşta güncel AIP, uçak el kitabı ve yetkili eğitmen esas alınmalıdır.
