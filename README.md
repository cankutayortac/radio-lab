# Radio Lab

VOR, NDB ve DME çalışmaları için Türkçe, tarayıcı tabanlı yatay seyrüsefer eğitmeni. Bilgisayar, tablet ve telefonda çalışır. Sunucu, hesap veya API anahtarı gerektirmeyen GitHub Pages sürümü içerir.

## İçerik

- 8 ders, 24 açıklamalı bilgi sorusu ve 7 değerlendirilen uçuş görevi.
- Tek HSI üzerinde NAV1/NAV2 course/CDI, farklı BRG1/BRG2 ibreleri ve ADF.
- Aktif/standby frekans ayarı, mors kimliği, course/heading sliderları.
- Küresel yatay geometri, rüzgâr, koordineli dönüş ve DME eğik mesafesi.
- Rehberli/sınav modları; uçuş geçmişi yalnız kullanılan tarayıcıda saklanır.
- Yedi görevin tamamında açıklamalı değerlendirme, eşzamanlı HSI/harita tekrarı ve ayar değişikliği çizelgesi.
- Tüm ekranlarda Kokpit / Harita / Görevler çalışma alanları; bilgisayarda HSI ve harita yan yana.
- Telefon ve tablette alt gezinme, büyük dokunma alanları ve kesintiye dayanıklı sliderlar.

## Yeni uçuş masası

1. **Görevler** sekmesinden bir görev kartı seçin; görev duraklatılmış olarak hazırlanır. Ders ve görev numaraları birbirinden ayrıdır.
2. Standby frekanslarını girip ↔ ile aktif yapın; CDI kaynağını ve CRS değerini ayarlayın.
3. **Görevi başlat** ile uçun. HDG uçağın başını kumanda eder; CRS yalnızca seçili yolu değiştirir.
4. Koşullar sağlanınca görev kendiliğinden biter ve değerlendirme açılır. Erken bitirmek için **Bitir ve değerlendir** kullanın. Derslerden brifinge geçmek devam eden uçuşu sıfırlamaz.

Bilgi testi yanıtları ders/kokpit sekmelerine gidip dönünce korunur; yeni test başlatmak veya sayfayı yenilemek mevcut test oturumunu sıfırlar. Tamamlanmış sonuçlar tarayıcı kaydında tutulur. Ekran boyutu değişirken sürükleme iptal edilir; seçili course ve heading kendiliğinden eşlenmez.

## Görev başlatma ve yarım kalan uçuşlar

Görev kartını seçmek görevi duraklatılmış olarak hazırlar. Frekansları, CDI kaynağını ve CRS değerini ayarlayın; **Görevi başlat** ile uçun. Serbest uçuş ayrı etiketlenir ve görev sonucu oluşturmaz. Görev koşulları sağlanınca uçuş kendiliğinden biter ve değerlendirme açılır; **Bitir ve değerlendir** erken bitirmek içindir.

Rehberli uçuşta ilerleme şeridi eksik ayarı veya tamamlanmayı bekleyen koşulu gösterir. İstenen kararlı süre, toplam uçuş süresi değil kesintisiz tolerans içi süredir; tolerans dışına çıkınca yeniden başlar. DME arc ve istasyon geçişi ayrıca kendi ilerleme/aşama koşullarını ister. Sınav sırasında bu ipuçları gösterilmez.

Başlamış görevler yaklaşık iki saniyede bir aynı tarayıcıda ara kaydedilir. Sayfa yenilendiğinde veya tarayıcı yeniden açıldığında kurtarma kartından **Duraklatılmış geri yükle** seçilebilir. Uçuş konumu, frekanslar, her iki CRS, HDG, sınav seçimi, değerlendirme ilerlemesi ve tekrar geçmişi korunur; uçuş güvenle duraklatılmış ve 1× hızda açılır. Son birkaç saniyenin kaydı kapanışta garanti edilmez. Hiç başlamamış hazırlıklar veya güncellemeden önce kaydedilmemiş uçuşlar geri getirilemez.

Ara kayıt diğer sekmede devralınırsa eski sekme duraklar; aynı uçuş iki kez sonuçlandırılmaz. Tamamlanmış ya da kaldırılmış ara kayıt geç gelen bir yazmayla yeniden görünmez. Depolama kullanılamadığında uyarı gösterilir; sekmeyi kapatmadan uçuşu bitirin. Farklı tarayıcılar, cihazlar ve iki farklı site adresi arasında kayıt eşitlemesi yoktur.

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

## Uçuş tekrarı ve geri bildirim

Bir görevi bitirdikten sonra **Uçuş defteri → İncele** ile kaydı açın. Zaman sürgüsü veya olay satırlarıyla aynı anın HSI, uçuş izi, NAV1/NAV2, iki CRS, ADF, bearing kaynakları, seçili baş ve yer izini karşılaştırın. Oynatma hızı 0.5×–4× arasında seçilebilir. Tekrar kumandaları canlı uçuşu değiştirmez; sınavın kendi geri bildirimi ancak uçuş bitince açılır.

Açıklamalar yedi görevin ayrı koşullarını kullanır; ayar/sinyal eksikliği pilotaj hatası sayılmaz. Bunlar kayıtlı geometriye dayalı eğitim açıklamalarıdır, pilotun niyetine ilişkin tahmin veya sertifikalı değerlendirme değildir. Geometri yaklaşık 0.25 saniyede bir, ayar değişiklikleri ayrıca kaydedilir; kareler arasında yapay alıcı durumu üretilmez.

Son 50 sonuç özeti mevcut yerel uçuş defterinde, son 20 ayrıntılı tekrar IndexedDB içinde tutulur. Aynı cihazdaki farklı site adresleri veya farklı tarayıcılar eşitlenmez. Tarayıcı verilerini silmek kayıtları da siler; depolama kapalı/doluysa ayrıntılı tekrar yalnız oturumda kalabilir ve uyarı gösterilir. Eski sonuçlar korunur fakat geçmişte kaydedilmemiş uçuşlara tekrar oluşturulmaz. Kayıt başına 12.000 kare sınırı aşılırsa erken tarihçe ve son kare korunur, aradaki boşluk belirtilir.

## Eğitim kaynakları ve sınırlar

Kullanıcının sağladığı Efe Can Birinci v2 Rev01 notları ile IFR.PDF eğitim dokümanı temel alınarak özgün Türkçe ders ve sorular hazırlanmıştır. Kaynak PDF dosyaları ve chart görselleri bu depoya dahil değildir; uygulamada PDF sayfa referansları verilir.

HSI geometrisi Garmin'in resmi G1000/NXi kılavuzlarından incelenmiştir. Bu proje Garmin ürünü değildir; sertifikalı bir simülatör veya operasyonel seyrüsefer kaynağı değildir. Gerçek G1000 ayrı DME penceresi kullanabilir; burada eğitim tercihi olarak DME ilgili bearing altında gösterilir. Harita OpenStreetMap'tir, resmî yaklaşma chartı değildir. Sabit 120 KTAS, 4.200 ft MSL, 6°E senaryo varyasyonu ve basitleştirilmiş sinyal modeli kullanılır. Dikey yaklaşma, ILS ve otomatik puanlanan tam holding kapsam dışıdır. Ayrıntılar uygulamanın Kaynaklar bölümündedir.

İstasyon verileri dondurulmuş senaryo verileridir. Gerçek uçuşta güncel AIP, uçak el kitabı ve yetkili eğitmen esas alınmalıdır.
