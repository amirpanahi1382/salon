# ارزیابی هم‌راستایی رسالت و وضعیت فعلی محصول

**تاریخ ارزیابی:** ۱۸ مهر ۱۴۰۵

**مخزن:** `/Users/amir-panahi/Desktop/salon`

**شاخه:** `cursor/opportunity-action-layer`
**HEAD:** `7c87a7f386566b76d4b2c29a51d7da407ac39d76`

> یافته‌های این سند مربوط به همان ارزیابی است، پیش از پیاده‌سازی پشتیبانی. پیشنهاد آن زمان برای برش اول، case متصل به `MessageRequest` یا `VipRequest` بود. تصمیم بعدی، که پیاده‌سازی شده، این است: یک گفت‌وگو برای هر کاربر واردشدهٔ سالن با Platform Admin، از «حساب من» با عنوان «ارتباط با پشتیبانی»، و صندوق جدا «ارتباط با کاربران» برای Admin. پیام پشتیبانی وضعیت پیام عادی یا VIP را عوض نمی‌کند. آن طرح متصل به درخواست قرارداد جاری نیست.

## نتیجهٔ اجرایی

محصول امروز می‌تواند به‌صورت صادقانه به‌عنوان یک ابزار ساده برای مدیریت سابقهٔ مشتری، تشخیص فرصت‌های بازگشت، ثبت درخواست پیام و اجرای دستی پیام‌رسانی توسط Admin فروخته شود. قابلیت VIP نیز یک مسیر واقعی برای درخواست تماس با مخاطبان جدید دارد: انتخاب منطقه و لیست، سهمیهٔ ۵۰۰ مخاطب در هفت روز، یک پیش‌نویس فعال، بارگذاری نمونه‌کار، ثبت درخواست و اجرای دستی Admin.

این محصول هنوز نمی‌تواند وعدهٔ «جذب مشتری جدید» را به معنای نتیجهٔ اثبات‌شده بدهد. واقعیت ثبت‌شده در انتهای مسیر VIP حداکثر نشان می‌دهد Admin پیام را دستی رسیدگی کرده است؛ تحویل قطعی به گیرنده، پاسخ مخاطب، تبدیل به Customer، Visit یا درآمد منتسب به درخواست VIP اثبات نمی‌شود.

سه شکاف اصلی نسبت به رسالت عبارت‌اند از:

1. گفت‌وگوی درون‌برنامه‌ای میان سالن و Admin وجود ندارد؛ پیگیری ابهام یا مشکل از بافت درخواست جدا می‌شود.
2. سالن تاریخچهٔ کامل و قابل اقدام از درخواست‌های VIP ندارد؛ خلاصهٔ capability فقط ده درخواست اخیر در جریان را نشان می‌دهد و مرحلهٔ بعد همیشه روشن نیست.
3. محصول نتیجهٔ جذب را ثبت یا اندازه‌گیری نمی‌کند؛ «رسیدگی دستی»، «تحویل»، «بازگشت» و «درآمد» باید جدا بمانند.

اولین برش پیشنهادیِ این ارزیابی، گفت‌وگوی پشتیبانی متنی و tenant-scoped متصل به درخواست‌های پیام و VIP بود. این پیشنهاد مدل عملیاتی دستی موجود را کامل می‌کرد، هزینهٔ پیگیری را کاهش می‌داد و امکان بازسازی ادعای کاربر را فراهم می‌کرد، بدون آن‌که موتور کمپین یا پیام‌رسان دوم بسازد. این پیشنهاد تاریخی است. نسخهٔ پیاده‌شده به درخواست وصل نیست و از «حساب من» باز می‌شود.

## تعارض جایگاه محصول

سند رسالت، «جذب مشتری جدید» را ارزش اصلی و CRM/retention را ارزش پشتیبان تعریف می‌کند. در مقابل، `AGENTS.md`، `business-model.md` و `product-strategy.md`، «درآمد از مشتریان موجود» و Retention & Revenue Intelligence را محور اصلی می‌دانند و VIP را قابلیت مجاور معرفی می‌کنند.

این اختلاف یک خطای فنی نیست؛ یک تصمیم جایگاه محصول است. اجرای فعلی هر دو جهت را پشتیبانی می‌کند، ولی عمق آن‌ها برابر نیست:

- retention از Customer تا Visit، Transaction، Opportunity، MessageRequest، ReturnCommitment و شواهد بازگشت مسیر عمیق‌تری دارد؛
- acquisition از لیست پلتفرم تا VipRequest و اجرای دستی مسیر واقعی دارد، اما نتیجهٔ جذب را ثبت نمی‌کند.

تا تصمیم محصول روشن نشود، متن فروش باید هر دو را صادقانه بیان کند: «دسترسی به مخاطبان جدید با اجرای انسانی Admin» و «پیگیری مشتریان فعلی برای بازگشت». پیشنهاد بازنویسی اسناد راهبردی، خارج از این audit است و باید پس از تصمیم مالک محصول انجام شود.

## وضعیت محیط و اعتبار شواهد

- Git فقط `apps/mobile/android/build/` را به‌صورت untracked نشان می‌دهد؛ staged یا tracked diff وجود ندارد و `git diff --check` پاک است.
- API روی پورت 3000 از `apps/api/dist/main` اجرا می‌شود و readiness آن PostgreSQL را `up` گزارش می‌کند.
- PostgreSQL آزمایشیِ مجزا روی loopback فعال بود و API فقط به همان محیط disposable اتصال داشت؛ شناسهٔ منبع و پورت آن از نسخهٔ قابل انتشار حذف شده‌اند.
- emulator برابر `emulator-5554` فعال است.
- Flutter از checkout همان زمان با یک proxy آزمایشی به API متصل بود؛ آدرس و پورت اجرای موقت در نسخهٔ قابل انتشار نگه داشته نشده‌اند.
- artifactهای اجرا SHA درون خود ندارند؛ بنابراین «اجرا از مسیر checkout فعلی» مشاهده شده، اما تطابق بایت‌به‌بایت binary اجراشده با HEAD یک فرض تأییدنشده است.
- هیچ دادهٔ persistent در این audit تغییر نکرد.

## ماتریس هم‌راستایی رسالت

| نیاز یا گزارهٔ رسالت | سفر واقعی | قابلیت فعلی | وضعیت | نوع شواهد | شکاف دقیق | اثر بر ارزش قابل فروش | اقدام پیشنهادی |
| --- | --- | --- | --- | --- | --- | --- | --- |
| برنامه ساده و قابل فهم باشد | ورود و رسیدن به کار روزانه | navigation پنج‌تب فارسی، Today، Customers، Visits، Opportunities، Profile | PARTIAL | مشاهده در emulator + source | Opportunities چند مفهوم acquisition، messaging و revenue drop را در یک سطح ترکیب می‌کند | شروع کار ممکن است، ولی مدل ذهنی محصول واضح نیست | onboarding کوتاه و توضیح مأموریت هر تب |
| جذب مشتری جدید ارزش اصلی باشد | سالن منطقه و لیست VIP را انتخاب می‌کند، نمونه‌کار می‌دهد و درخواست می‌فرستد | مسیر VIP کامل تا `VipRequest` و صف دستی Admin | PARTIAL | مشاهدهٔ UI، تست موجود، source | نتیجهٔ واقعی جذب ثبت نمی‌شود | می‌توان «درخواست outreach» فروخت، نه «مشتری جدید تضمین‌شده» | تاریخچه/جزئیات VIP و سپس تعریف outcome واقعی |
| سهمیه و چند درخواست روشن باشد | چند درخواست ثبت‌شده و یک draft | 500 مخاطب در rolling 7 days، اندازه‌های 30/50/100، یک `AWAITING_SAMPLE_WORK` | COMPLETE | source + migration + تست و walkthrough قبلی | فقط ده درخواست اخیر در capability | محدودیت تجاری روشن است؛ تاریخچه کامل نیست | endpoint تاریخچهٔ paginated |
| CRM مشتریان فعلی | ساخت، جست‌وجو، ویرایش، import و activity | Customer CRUD/import/activity در API و Flutter | COMPLETE | source + تست موجود + UI قبلی | user-admin در Flutter غایب است، ولی CRM مشتری فعال است | ارزش مستقل و قابل فروش | بهبود onboarding، نه بازطراحی CRM |
| بازگرداندن مشتری سابق | فرصت، پیام، تعهد بازگشت، arrival و recovery | مسیر retention و شواهد `COMMITMENT_BACKED`/`OBSERVED` | COMPLETE | source + تست موجود + UI | causal attribution وجود ندارد | پیگیری و شواهد واقعی قابل فروش است | copy غیرعلّی را حفظ کن؛ analytics پیشرفته بعداً |
| اجرای دستی Admin معتبر باشد | Admin صف عادی/VIP را باز می‌کند و sent/cancel را ثبت می‌کند | دو workspace، folder، capabilityهای server-owned | COMPLETE | source + تست موجود | manual-sent تحویل قطعی نیست | مدل عملیاتی فعلی قابل استفاده است | wording و evidence legend ثابت بماند |
| کار روزانه Admin واضح باشد | پیدا کردن سالن و درخواست نیازمند اقدام | folderهای عادی و VIP، شمارنده pending/failed | PARTIAL | source inspection | priority/SLA، aging و «چرا نیازمند اقدام است» محدود است | در حجم بالاتر هزینهٔ عملیات زیاد می‌شود | صف attention با reason و age مشتق‌شده |
| سالن با Admin داخل برنامه حرف بزند | سؤال درباره درخواست یا گزارش مشکل | در زمان ارزیابی هیچ Support/Conversation API، model یا route وجود نداشت | MISSING در زمان ارزیابی | جست‌وجوی schema/module/router | ارتباط بیرون از بافت درخواست انجام می‌شد | اعتماد و سرعت حل مسئله افت می‌کند | پیشنهاد آن زمان: SupportCase/SupportMessage محدود و request-linked. پیاده‌سازی بعدی این پیشنهاد را جایگزین کرد |
| اپراتور رخداد ادعاشده را بازسازی کند | بررسی request/delivery/audit با ID | IDs، audit، outbox، diagnostic codes و status history وجود دارد | PARTIAL | source + docs + tests قبلی | view تجمیعی support timeline برای Admin وجود ندارد | تیم فنی می‌تواند بررسی کند، اپراتور عادی سخت‌تر | پیشنهاد آن زمان: timeline خواندنی روی SupportCase. نسخهٔ پیاده‌شده case نساخت |
| نتیجهٔ پیام قابل مشاهده باشد | sent → commitment → visit → associated revenue | ordinary messaging دارای return evidence است | COMPLETE برای retention | source + تست موجود + UI | proof delivery/read یا causality نیست | ارزش retention با زبان دقیق قابل فروش است | تمایز evidence را حفظ کن |
| نتیجهٔ جذب VIP قابل مشاهده باشد | recipient outreach → inquiry/visit/revenue | sent count و request state موجود است | PARTIAL | source inspection | response/new-customer/outcome وجود ندارد | وعده acquisition اثبات نمی‌شود | discovery محصول و outcome fact با provenance |
| قوانین مالک معماری داشته باشند | quota، reservation، send، recovery | VIP، Messaging، Recovery، Intelligence ownerهای مشخص دارند | COMPLETE | source inspection | در زمان ارزیابی support owner وجود نداشت چون قابلیت غایب بود | پایهٔ فنی قابل اعتماد | پیشنهاد: module مستقل و کوچک. همان شکل پیاده شد، بدون مالکیت messaging/VIP |
| کد بدون ارزش حذف شود | endpointها و worker eventها | چند probe/no-op event و Redis config بلااستفاده مستند است | UNVERIFIED برای حذف | docs + source محدود | وابستگی عملیاتی/compatibility کامل بررسی نشده | حذف شتاب‌زده ریسک recovery دارد | فقط پس از runtime inventory و migration compatibility |
| کنترل consent/opt-out | تماس با مشتری و VIP | پیاده‌سازی نشده | MISSING | docs + source | stop/opt-out و سیاست تماس ثبت نمی‌شود | گسترش outreach ریسک عملیاتی/اعتماد دارد | تصمیم سیاست و enforcement پیش از scale |
| مدیریت اعضای سالن | OWNER/MANAGER کاربر می‌سازد و نقش می‌دهد | API کامل؛ Flutter surface ندارد | PARTIAL | source inspection | کاربر عادی از اپ قابل مدیریت نیست | onboarding تیم سالن سخت‌تر می‌شود | Flutter user admin پس از شکاف‌های اصلی |

## سفرهای اصلی و مالکیت

| سفر | مسیر serving | مالک قانون | مرز transaction و داده | Flutter چه می‌کند |
| --- | --- | --- | --- | --- |
| ثبت‌نام و ورود | Auth screens → `/auth/register|login` → Auth use cases → Salon/User | `auth` | ثبت Salon+OWNER+audit+outbox در یک transaction | input و نمایش خطا؛ tenant را تعیین نمی‌کند |
| CRM | Customer screens/repository → `/customers` → customer use cases/repository | `customer` | Customer واقعیت tenant-scoped؛ import اتمیک طبق قرارداد | فرم، جست‌وجو، pagination، activity |
| Visit و sale | RecordVisit → `/visits` یا `/visits/complete-with-sale` | `visit` + `transaction` | Visit و Transaction/Item در sale یک transaction؛ Decimal IRR | زمان/مبلغ را جمع می‌کند، قانون پول backend-owned است |
| retention | Opportunities → `/opportunities/workspace` → derived queries | `opportunities`/`intelligence` | derived on read؛ MessageRequest واقعیت جدا | filter و انتخاب، rule را محاسبه نمی‌کند |
| پیام عادی | composer → `/customers/:id/messages` → messaging use case | `messaging` | MessageRequest+audit+outbox اتمیک؛ delivery بعدی | متن و انتخاب؛ mode delivery را انتخاب نمی‌کند |
| پیگیری بازگشت | message/commitment UI → return/recovery endpoints | `return-commitment` + `recovery-outcomes` | commitment واقعیت؛ evidence مشتق‌شده؛ Visit/Transaction تغییر نمی‌کند | ثبت زمان توافق، arrival و نمایش evidence |
| VIP acquisition | SalonVipSection → `/vip/*` → VIP use cases/repository | `vip` | entitlement lock، quota، reserve، recipients، audit/outbox اتمیک؛ object I/O خارج DB transaction | region/list/count/sample را نمایش و ارسال می‌کند |
| صف دستی Admin | Admin screens → `/admin/message-queue`, `/admin/messages/normal`, `/admin/vip/outreach` | `messaging` و `vip` | transitionهای request/delivery با capability و fencing | اقدام مجاز را فقط بر اساس capability نشان می‌دهد |
| ارتباط سالن/Admin | در زمان ارزیابی مسیر نداشت | مالک نداشت | داده‌ای persist نمی‌شد | UI نداشت. نسخهٔ پیاده‌شده جدا از این جدول است |

## نقد UI/UX

1. **UX friction** — صفحهٔ «فرصت‌ها» هم پیام عادی، VIP و «افت درآمد» را کنار هم می‌گذارد. کاربر تازه نمی‌فهمد کدام مسیر برای جذب و کدام برای نگهداشت است. کوچک‌ترین بهبود: یک توضیح یک‌خطی زیر هر filter و دو گروه معنایی «جذب مشتری جدید» و «بازگشت مشتریان».

2. **UX friction** — وضعیت‌هایی مثل «نیازمند بررسی» در تاریخچهٔ VIP، اقدام بعدی سالن یا Admin را روشن نمی‌کنند. کوچک‌ترین بهبود: label وضعیت + actor بعدی + آخرین زمان تغییر + لینک جزئیات.

3. **Functional defect** — تاریخچهٔ VIP کامل از UI قابل دسترسی نیست؛ capability فقط ده ردیف اخیر در جریان و `hasMore` دارد، اما route تاریخچه وجود ندارد. سالن با بیش از ده درخواست نمی‌تواند گذشته را مرور کند.

4. **Functional defect** — ارتباط درون‌برنامه‌ای سالن و Admin که رسالت صریحاً می‌خواهد، وجود ندارد.

5. **UX friction** — در صفحهٔ Today، اعداد کلی بدون onboarding ممکن است به‌عنوان اثر قطعی محصول فهمیده شوند. copy باید «ثبت‌شده/مرتبط» را در همان کارت و نزدیک عدد نشان دهد.

6. **Visual or subjective recommendation** — theme تیره و طلایی هویت منسجمی دارد، ولی تراکم متن خاکستری و اندازهٔ برخی توضیحات در صفحات طولانی VIP خوانایی را کم می‌کند. افزایش contrast متن ثانویه و فاصلهٔ گروه‌ها کافی است؛ redesign کامل لازم نیست.

7. **Visual or subjective recommendation** — نوشتن `vip` با حروف کوچک در متن فارسی ناهماهنگ است. از «VIP» یا ترجمهٔ ثابت «ارسال ویژه» در همهٔ labelها استفاده شود.

8. **Product hypothesis requiring user feedback** — ممکن است سالن منطقه را بهتر از کد 01 تا 14 با نام محله/محدوده بفهمد. پیش از تغییر taxonomy باید با 5 تا 8 کاربر پایلوت بررسی شود.

9. **Product hypothesis requiring user feedback** — آیا سالن ارزش را از «تعداد پیام رسیدگی‌شده»، «تعداد تماس/پاسخ»، یا «مشتری جدید ثبت‌شده» می‌سنجد؟ پاسخ، طراحی outcome acquisition را تعیین می‌کند.

## ارزش قابل فروش و وعده‌های غیرقابل ارائه

### قابل فروش امروز

- CRM سبک با سابقهٔ مشتری، مراجعه و فروش ثبت‌شده؛
- فهرست روزانه برای پیگیری و بازگرداندن مشتریان؛
- درخواست پیام عادی با اجرای دستی یا Bale برای مسیر مجاز؛
- درخواست outreach به لیست‌های اصلی تهران با entitlement، quota و اجرای دستی Admin؛
- ثبت تعهد بازگشت و نمایش مراجعه/درآمد ثبت‌شدهٔ مرتبط برای مشتریان موجود؛
- تاریخچه و کنترل فنی قابل اتکا برای idempotency، audit، outbox و retry.

### وعده‌هایی که امروز نباید داده شوند

- تحویل یا خوانده‌شدن قطعی پیام؛
- تعداد مشتری جدید حاصل از VIP یا درآمد افزایشی منتسب به آن؛
- پیام‌رسانی خودکار VIP؛
- پشتیبانی chat بلادرنگ داخل اپ (نسخهٔ بعدی فقط متن با refresh دستی است)؛
- campaign engine، broadcast یا bulk attribution؛
- subscription/billing؛
- compliance کامل consent/opt-out؛
- مدیریت کاربران سالن از Flutter.

## تفکیک سطح اطمینان

- **مشاهده مستقیم:** اپ در emulator، صفحه Opportunities، empty state، region picker، quota exhausted، چند درخواست VIP و Today.
- **اجرای synthetic قبلی معتبر:** چند درخواست VIP، quota 500/7 days، یک draft فعال و صفحات مختلف quota؛ تست‌های گزارش‌شده روی همان commit.
- **نتیجهٔ source-based:** مالکیت moduleها، transactionها، نبود support/chat، محدودیت 10 ردیف capability، API user admin بدون Flutter.
- **استنباط:** مدل فروش مناسب برای پایلوت، هزینهٔ عملیاتی ناشی از نبود support thread و خطر سوءبرداشت از outcome.
- **UNVERIFIED:** رفتار محیط production، کیفیت واقعی ارسال دستی، رضایت سالن، willingness to pay، compliance حقوقی و conversion واقعی VIP.

## نمایهٔ شواهد کد

- routing و سطح‌های اصلی Flutter: `apps/mobile/lib/core/routing/app_router.dart:37`, `:80`, `:90`, `:135` و `apps/mobile/lib/features/shell/app_shell.dart:7`.
- UI و خلاصهٔ VIP: `apps/mobile/lib/features/vip/salon_vip_section.dart:45`, `:405`, `:505` و مدل `apps/mobile/lib/shared/models/models.dart:1094`.
- سقف و پنجرهٔ سهمیه: `packages/shared/src/vip.ts:61-65`.
- snapshot capability و محدودیت ده درخواست: `apps/api/src/vip/vip.use-cases.ts:614-654`.
- transaction ساخت درخواست، entitlement lock، یک draft، quota و reserve: `apps/api/src/vip/vip.use-cases.ts:701-772` و `apps/api/src/vip/vip.repository.ts:209-282`.
- invariant یک draft در database: `packages/database/prisma/migrations/20261007140000_vip_one_awaiting_draft_per_salon/migration.sql:11`.
- workspace دستی Admin و capabilityهای اقدام: `apps/mobile/lib/features/admin/admin_message_queue_screen.dart:16`, `:522-533` و `apps/mobile/lib/features/admin/admin_vip_outreach_screen.dart:392`, `:555-565`.
- Today و recovery entry: `apps/mobile/lib/features/dashboard/dashboard_screen.dart:13`, `:40`, `:119-129`.
- API مدیریت کاربر بدون route Flutter: `apps/api/src/user/user.controller.ts:19-70` و `docs/current-state-system-spec.md:246`.
- consent و VIP Bale به‌عنوان شکاف مستند: `product/mvp.md:90-91` و `docs/technical-debt.md` (`TD-12`, `TD-15`).
- نبود support/chat در زمان ارزیابی: جست‌وجو در `packages/database/prisma/schema.prisma`, `apps/api/src/app.module.ts` و `apps/mobile/lib/core/routing/app_router.dart` هیچ model/module/route مرتبطی برنگرداند.

## پرسش‌های باز محصول

1. north star رسمی کدام است: acquisition، retention، یا ترکیب مرحله‌ای با یک ترتیب مشخص؟
2. outcome قابل قبول برای VIP چیست: پاسخ مخاطب، مراجعه، تبدیل به Customer، یا درآمد ثبت‌شده؟
3. چه کسی outcome VIP را ثبت می‌کند و چه مدرکی لازم است: سالن، Admin یا هر دو؟
4. سیاست consent/opt-out برای مشتریان سالن و مخاطبان VIP در بازار هدف چیست؟
5. آیا support thread باید به request متصل باشد، یا یک inbox عمومی سالن نیز لازم است؟ پیشنهاد این audit، request-linked در نسخهٔ اول بود. تصمیم پیاده‌شده آن پرسش را این‌طور بسته است: نه case روی درخواست، بلکه یک گفت‌وگو برای هر کاربر سالن از «حساب من»، با صندوق Admin جدا از صف پیام و VIP.
