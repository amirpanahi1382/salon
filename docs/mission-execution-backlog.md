# backlog اجرایی هم‌راستایی رسالت

این backlog از ارزیابی `docs/mission-alignment-audit.md` مشتق شده است. ترتیب، بر اساس رفع شکاف ارزش قابل فروش، کاهش هزینهٔ Admin و حفظ مالکیت معماری تعیین شده است. تاریخ تحویل برآورد نشده است.

## ترتیب پیشنهادی

1. **MA-01 — گفت‌وگوی پشتیبانی هر کاربر سالن با Platform Admin:** در این شاخه پیاده‌سازی و روی محیط disposable تأیید شده؛ rollout پایدار هنوز انجام نشده است.
2. **MA-03a — تعریف outcome خوداظهاری و منبع آن:** واژگان، ثبت‌کننده و معنای دقیق هر گزارش را با مالک محصول نهایی کنید.
3. **MA-03b — ثبت حداقلی outcome «گزارش‌شده توسط سالن»:** پس از MA-03a، فقط واقعیتی را ثبت و نمایش دهید که سالن واقعاً اعلام کرده است، با actor، زمان و امکان اصلاح بدون حذف سابقه.
4. **MA-02 — تاریخچه و جزئیات کامل VIP:** فعلاً به تعویق افتاده؛ اولویت آن بعد از مشاهدهٔ استفادهٔ واقعی UI دوباره سنجیده شود.
5. **MA-07 — بررسی حذف کدهای کم‌مصرف:** فقط پس از شواهد runtime و سازگاری، و نه به‌عنوان بازنویسی معماری.

گیت رضایت اولیهٔ تماس هنوز باز است. MA-00 V1 فقط توقف آیندهٔ ارسال را برای شمارهٔ قطعی، به درخواست گیرنده و فقط توسط Platform Admin، پیاده کرده است. این توقف اثبات رضایت اولیه یا ادعای انطباق حقوقی نیست.

---

## MA-00 — سیاست تماس، consent و توقف ارسال

- **وضعیت V1:** توقف سراسری آیندهٔ ارسال پیاده شده است. رضایت اولیه و بررسی حقوقی بازار همچنان خارج از این نسخه است.
- **اولویت:** P0؛ ریسک اعتماد و عملیات در تماس با مشتریان و مخاطبان VIP.
- **رسالت مرتبط:** جذب و بازگشت پایدار، با امکان رسیدگی به ادعای کاربر.
- **مسئله و شواهد:** docs و source صریحاً consent/opt-out را فاقد پیاده‌سازی می‌دانند.
- **اگر اکنون ساخته نشود:** گسترش outreach واقعی بدون قرارداد روشن برای توقف تماس، کار اپراتور و اعتماد مخاطب را تهدید می‌کند.
- **خروجی قابل مشاهده:** Admin و سالن می‌دانند چه مخاطبی قابل تماس نیست و درخواست جدید برای او رد می‌شود.
- **در scope:** تصمیم محصول/حقوقی بازار هدف، مدل suppression tenant/platform، reason و timestamp، enforcement در ایجاد MessageRequest/VIP dispatch، UI توضیح blocked state.
- **خارج از scope:** مرکز ترجیحات بازاریابی، automation چندکاناله، مشاوره حقوقی عمومی.
- **مالک:** `messaging` برای مشتری سالن؛ تصمیم جدا درباره مالکیت VIP در `vip` یا policy مشترک کوچک.
- **ماژول‌های درگیر:** messaging، vip، customer، admin UI.
- **API/schema:** محتمل؛ suppression fact و endpointهای ثبت/رفع با audit.
- **قیود:** tenant isolation، عدم افشای شماره، تاریخچهٔ پیام حذف نشود، suppression مانع retry نیز باشد.
- **معیار پذیرش:** درخواست جدید برای مقصد suppressed رد شود؛ retry قدیمی ارسال جدید تولید نکند؛ رفع suppression audit شود؛ تاریخچه خوانا بماند.
- **تست حداقل:** tenant، ordinary/VIP، retry، idempotency، Admin walkthrough.
- **وابستگی:** تصمیم مالک محصول و بررسی حقوقی بازار.
- **اندازه:** M؛ قانون ساده است ولی دو origin پیام را پوشش می‌دهد.
- **ریسک rollout:** historical destinations و تعریف scope suppression باید صریح باشد.

## MA-01 — گفت‌وگوی پشتیبانی

تصمیم پیاده‌شده: یک گفت‌وگو برای هر کاربر واردشدهٔ سالن با Platform Admin. از «حساب من» با عنوان «ارتباط با پشتیبانی» باز می‌شود، از جمله برای نقش‌هایی که «مدیریت خدمات» را نمی‌بینند. Admin صندوق جدا «ارتباط با کاربران» دارد و آن را با صف پیام عادی یا VIP مخلوط نمی‌کند. گفت‌وگو به MessageRequest یا VipRequest وصل نیست و وضعیت آن‌ها را عوض نمی‌کند. کاربران یک سالن گفت‌وگوهای جدا دارند. طرح case متصل به درخواست، پایین‌تر، فقط سابقهٔ پیشنهاد است و قرارداد این برش نیست.

وضعیت: پیاده‌سازی و آزمون disposable انجام شده است. مهاجرت `20261010180000_support_conversations` روی پایگاه پایدار `salon` اعمال شده است (دفتر مهاجرت تمام‌شده، بدون ردیف ناموفق). rollout موبایل و استفادهٔ واقعی از این گفت‌وگو تأیید نشده است. گام بعدی این بخش بازبینی انتشار کلاینت است، نه اعمال دوبارهٔ همان مهاجرت.

## یادداشت تاریخی MA-01

پیشنهاد اولیهٔ backlog، case متصل به `MessageRequest` یا `VipRequest` با close/reopen بود. تصمیم محصول بعدی آن را کنار گذاشت؛ این مدل ساخته نشده و جزو کارهای بعدیِ تأییدشده نیست. قرارداد جاری در brief پیاده‌سازی MA-01 و بخش 11A وضعیت فعلی آمده است.

## MA-02 — تاریخچه و جزئیات کامل VIP برای سالن

- **اولویت:** deferred؛ پس از شواهد استفادهٔ واقعی از UI دوباره اولویت‌گذاری شود. نبود تاریخچهٔ کامل نباید با ادعای شفافیت کامل در فروش پنهان شود.
- **رسالت مرتبط:** شفافیت کار Admin و فهم اینکه چه اتفاقی افتاده و چه کسی باید اقدام کند.
- **مسئله و شواهد:** capability فقط ده request در جریان دارد و `hasMore` بدون route تاریخچه است؛ statusها next actor را توضیح نمی‌دهند.
- **اگر اکنون ساخته نشود:** سالن با درخواست‌های متعدد نمی‌تواند سابقه یا دلیل انتظار را پیدا کند.
- **خروجی قابل مشاهده:** تاریخچه paginated، detail، timeline status و «اقدام بعدی با سالن/Admin».
- **در scope:** read-only history/detail، cursor، status mapping، sample summary، recipient totals و sent/failed facts بدون phone/body.
- **خارج از scope:** cancel جدید، edit بعد submit، campaign analytics، provider automation.
- **مالک:** `vip`؛ projectionهای delivery از `messaging` به‌صورت read-only.
- **ماژول‌های درگیر:** vip، messaging read model، Flutter.
- **API/schema:** ترجیحاً بدون schema؛ endpointهای read جدید.
- **قیود:** tenant scope، destination/message body عدم افشا، status truth از DB، live pagination با cursor معتبر.
- **معیار پذیرش:** بیش از ده request قابل مرور؛ detail با ID کاربرپسند؛ actor بعدی دقیق؛ stale response UI نادیده گرفته شود؛ empty/error/later-page states حفظ شوند.
- **تست حداقل:** pagination >10، tenant، concurrent insert semantics، Flutter later-page retry و emulator walkthrough.
- **وابستگی:** ندارد. طرح قبلی MA-01 می‌خواست از detail درخواست وارد شود؛ نسخهٔ پیاده‌شده از آن entry point استفاده نمی‌کند.
- **اندازه:** M؛ write rule ندارد ولی API و UI چند حالت دارد.
- **ریسک rollout:** کم؛ projection جدید و backward compatible.

قصد مراجعهٔ پیاده‌شده در این شاخه `VisitIntention` است و MA-03 را تمام نمی‌کند. این واقعیت «قصد مراجعه/زمان توافق‌شده» است، نه «مشتری جذب‌شده» و نه درآمد منتسب. `ReturnCommitment` و شواهد `COMMITMENT_BACKED` / `OBSERVED` همان قرارداد قبلی را دارند.

## MA-03a — تعریف outcome خوداظهاری و منبع آن

- **اولویت:** گام بعد از MA-01؛ تصمیم محصول پیش از هر schema یا UI جدید.
- **رسالت مرتبط:** جذب مشتری جدید و مشاهدهٔ نتیجه.
- **خروجی:** تعریف جداگانهٔ «سالن گزارش کرد مشتری قبلی بازگشته» و «سالن گزارش کرد مخاطب VIP به مشتری جدید تبدیل شده»؛ ثبت‌کننده، منبع، زمان ادعا، پیوند مجاز به درخواست و واژگان UI روشن شوند.
- **مرز شواهد:** هر دو خوداظهاری‌اند. هیچ‌کدام به‌تنهایی تحویل پیام، Visit ثبت‌شده، Customer جدید یا درآمد منتسب را اثبات نمی‌کنند.
- **معیار پایان:** مالک محصول واژگان و قواعد اصلاح/پس‌گرفتن گزارش را تأیید کند؛ مرز مالکیت `vip`، `customer`، `visit` و `transaction` و سطح ادعای قابل نمایش مشخص باشد. تا آن زمان schema ساخته نشود.

## MA-03b — ثبت حداقلی outcome گزارش‌شده توسط سالن

- **اولویت:** پس از MA-03a.
- **خروجی:** سالن فقط outcome توافق‌شده را اعلام می‌کند؛ UI همان را با برچسب «گزارش‌شده توسط سالن» و actor/time/source نشان می‌دهد.
- **مالکیت:** ماژول مالک outcome تنها گزارش و provenance خود را می‌نویسد؛ `vip` نباید Visit، Customer یا Transaction بسازد و Flutter نباید attribution محاسبه کند.
- **قیود:** tenant isolation، idempotency، ثبت اتمیک گزارش و audit بدون متن حساس، اصلاح با حفظ سابقه، و جدایی کامل self-report از delivery/visit/customer/revenue facts.
- **معیار پذیرش:** هر گزارش و اصلاحش قابل ردیابی باشد؛ retry گزارش تکراری نسازد؛ گزارش بازگشت مشتری قبلی با گزارش جذب از VIP قاطی نشود؛ هیچ عدد درآمد یا تبدیل قطعی صرفاً از ادعای سالن نتیجه‌گیری نشود.
- **تست حداقل:** tenant، replay، correction، provenance، UI wording و walkthrough روی دادهٔ synthetic.

برش «نمایش مراجعهٔ وصل‌شدهٔ VIP» فقط همین بخش از MA-03b است: تاریخچهٔ قصدهای درخواست VIP، ردیف وصل‌شده را با «مراجعهٔ ثبت‌شده» نشان می‌دهد و «مراجعه کرد» را برمی‌دارد. وضعیت از `operationallyOpen` می‌آید. این برش جذب، unlink، یا خوداظهاری بدون مراجعه را تعریف نمی‌کند و بقیهٔ MA-03b را نمی‌بندد.

## MA-04 — صف توجه روزانهٔ Admin

- **اولویت:** P2؛ کاهش زمان و خطای عملیات دستی.
- **رسالت مرتبط:** صف شفاف، قابل پیگیری و مدیریت.
- **مسئله و شواهد:** folder و counts موجود است، ولی age، attention reason و اولویت یکنواخت نیست.
- **اگر اکنون ساخته نشود:** با رشد حجم، Admin باید پوشه‌ها را دستی باز کند تا کار بعدی را بفهمد.
- **خروجی قابل مشاهده:** یک read model مرتب‌شده با «علت نیاز به اقدام»، زمان انتظار و destination نوع عادی/VIP.
- **در scope:** derived read فقط؛ filterهای pending/failed/ambiguous، aging، deep link.
- **خارج از scope:** workflow engine، assignment تیمی، SLA billing، queue جدید.
- **مالک:** reporting/read model در messaging؛ VIP status را نمی‌نویسد.
- **ماژول‌های درگیر:** messaging، vip read-only، Flutter admin.
- **API/schema:** بدون schema در نسخه اول؛ query/index فقط با evidence performance.
- **قیود:** canonical capabilityها حفظ؛ status جدید اختراع نشود؛ PII کمینه.
- **معیار پذیرش:** هر row reason و age دارد؛ کلیک به action مجاز می‌رود؛ stale/unknown destination امن می‌ماند.
- **تست حداقل:** ordering، pagination، capability، unknown destination و widget.
- **وابستگی:** MA-02 مفید ولی الزامی نیست.
- **اندازه:** M.
- **ریسک rollout:** query performance و wording priority.

## MA-05 — onboarding تا اولین ارزش

- **اولویت:** P2؛ بهبود adoption.
- **رسالت مرتبط:** برنامه ساده و قابل فهم.
- **مسئله و شواهد:** navigation موجود است، ولی توضیح acquisition در برابر retention و راه اولین اقدام وجود ندارد.
- **اگر اکنون ساخته نشود:** کاربر تازه ممکن است قبل از ثبت Customer یا درخواست VIP ارزش محصول را نفهمد.
- **خروجی قابل مشاهده:** checklist کوتاه role-aware: مشتری/مراجعه، فرصت بازگشت، یا entitlement VIP.
- **در scope:** guidance و deep link؛ progress مشتق‌شده از facts موجود.
- **خارج از scope:** gamification، tutorial طولانی، data seeding.
- **مالک:** Flutter presentation؛ facts از owners موجود.
- **ماژول‌های درگیر:** salon/customer/visit/vip read-only.
- **API/schema:** احتمالاً بدون schema؛ summary موجود کافی است، در غیر این صورت endpoint read کوچک.
- **قیود:** backend rules تکرار نشود؛ completion fact واقعی باشد.
- **معیار پذیرش:** OWNER تازه مسیر بعدی را می‌بیند؛ STAFF اقدام غیرمجاز نمی‌بیند؛ dismiss محلی اختیاری.
- **تست حداقل:** roles، empty/partial/complete states و 3 walkthrough.
- **وابستگی:** تصمیم positioning.
- **اندازه:** S/M.
- **ریسک rollout:** کم؛ خطر copy نادرست.

## MA-06 — مدیریت کاربران سالن در Flutter

- **اولویت:** P2؛ API آماده است و UI غایب.
- **رسالت مرتبط:** مدیریت سادهٔ عملیات سالن.
- **مسئله و شواهد:** `/users` create/list/role/status و last-owner invariant موجود، ولی route Flutter ندارد.
- **اگر اکنون ساخته نشود:** افزودن اپراتور بدون ابزار فنی ممکن نیست.
- **خروجی قابل مشاهده:** OWNER/MANAGER کاربر مجاز را می‌سازد و وضعیت را می‌بیند.
- **در scope:** list/create/status/role مطابق RBAC فعلی.
- **خارج از scope:** دعوت ایمیلی، reset password، چند سالن، permission سفارشی.
- **مالک:** `user`; Flutter فقط نمایش و command.
- **ماژول‌های درگیر:** auth، user، profile UI.
- **API/schema:** ندارد.
- **قیود:** last active OWNER، global email uniqueness، Argon2id، MANAGER فقط STAFF.
- **معیار پذیرش:** role matrix و conflict copy درست؛ password در log نرود؛ refresh state صحیح.
- **تست حداقل:** API موجود applicability، Flutter role widgets و emulator synthetic create.
- **وابستگی:** ندارد.
- **اندازه:** S/M.
- **ریسک rollout:** handling password و copy conflict.

## MA-07 — حذف کدهای کاندید بدون مصرف

- **اولویت:** LATER.
- **رسالت مرتبط:** پیچیدگی بدون ارزش حذف شود.
- **مسئله و شواهد:** `GET /auth/owner` probe، Redis config بدون client و eventهای no-op کاندید هستند؛ حذف امن اثبات نشده.
- **اگر اکنون ساخته نشود:** هیچ سفر اصلی شکست نمی‌خورد؛ فقط هزینهٔ نگهداری محدود باقی می‌ماند.
- **خروجی قابل مشاهده:** ندارد؛ صرفاً کاهش سطح نگهداری.
- **در scope:** runtime usage inventory، dependency graph، migration/ops compatibility و حذف کوچک.
- **خارج از scope:** rewrite معماری یا حذف recovery hooks.
- **مالک:** platform/architecture.
- **API/schema:** بسته به candidate؛ breaking API ممنوع بدون evidence.
- **قیود:** backward compatibility، worker recovery و deployed clients.
- **معیار پذیرش:** zero caller در source و runtime evidence، docs و tests به‌روز، rollout reversible.
- **تست حداقل:** build، contract regression و deployment check.
- **وابستگی:** پس از شواهد runtime و compatibility؛ به اجرای MA-02 وابسته نیست.
- **اندازه:** S برای هر candidate.
- **ریسک rollout:** caller بیرونی ناشناخته.

## کوچک‌ترین نسخهٔ قابل فروش

یک پایلوت مدیریت‌شده برای سالن‌های منتخب:

- ثبت مشتری، مراجعه و فروش؛
- تشخیص مشتری نیازمند پیگیری و درخواست پیام؛
- VIP برای درخواست outreach به مخاطبان منطقه‌ای با سقف روشن؛
- اجرای دستی Admin و statusهای واقعی؛
- نمایش شواهد بازگشت مشتریان موجود؛
- گفت‌وگوی پشتیبانی داخل اپ برای هر کاربر سالن، جدا از پیام عادی و VIP؛

این نسخه با عبارت «کمک به جذب و بازگشت مشتری با اجرای انسانی» فروخته می‌شود، نه «جذب تضمینی»، «تحویل قطعی» یا «درآمد منتسب».

## چرا این ترتیب درست است

MA-01 در پیشنهاد اول case متصل به درخواست بود؛ قرارداد پیاده‌شده یک گفت‌وگوی هر کاربر با Platform Admin است، بدون تغییر وضعیت messaging یا VIP. بعد از انتشار آن، MA-03a زبان دقیق خوداظهاری را تعریف می‌کند و MA-03b فقط همان گزارش قابل ردیابی را می‌سازد. MA-02 تا مشاهدهٔ نیاز واقعی در UI عقب می‌ماند. MA-00 گیت موازی پیش از گسترش outreach واقعی است. MA-07 نیز فقط پس از شواهد runtime و سازگاری بررسی می‌شود.

## مواردی که عمداً عقب می‌افتند

- VIP Bale و automation provider؛
- campaign aggregate و bulk blast؛
- attribution causal و influenced revenue؛
- realtime chat/WebSocket و attachment؛
- billing/subscription؛
- marketplace، booking، payroll و inventory؛
- LLM/ML برای retention یا support؛
- حذف کدهای کاندید پیش از اثبات runtime usage.
