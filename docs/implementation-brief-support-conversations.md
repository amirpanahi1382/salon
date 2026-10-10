# brief پیاده‌سازی MA-01: گفت‌وگوی پشتیبانی هر کاربر سالن

**وضعیت:** در این شاخه پیاده‌سازی و روی محیط disposable بررسی شده است؛ migration هنوز روی پایگاه پایدار اعمال نشده است. شرح وضعیت جاری در `docs/current-state-system-spec.md` بخش 11A است.

## هدف و تجربهٔ کاربر

هر کاربر واردشدهٔ سالن، مستقل از دیگر کاربران همان سالن، از «حساب من» و دکمهٔ «ارتباط با پشتیبانی» گفت‌وگوی متنی خود را با Platform Admin باز می‌کند. دکمه زیر «مدیریت خدمات» قرار می‌گیرد؛ نقش STAFF که مدیریت خدمات ندارد نیز به پشتیبانی دسترسی دارد. کاربر تاریخچه را می‌بیند، متن می‌فرستد و پاسخ Admin را با refresh دستی دریافت می‌کند.

Platform Admin از مقصد مستقل «ارتباط با کاربران» فهرست گفت‌وگوها و نشانگر «نیاز به پاسخ» را می‌بیند، گفت‌وگوی کاربر را باز می‌کند و پاسخ می‌دهد. این مقصد با صف پیام عادی و VIP یکی نیست.

## قرارداد و مالکیت

- ماژول مستقل `support` مالک `SupportConversation` و `SupportMessage` است. برای هر `userId` دقیقاً یک conversation وجود دارد؛ هر conversation به `salonId` همان کاربر محدود است.
- هویت سالن و کاربر از JWT می‌آید؛ UI نمی‌تواند tenant یا author را انتخاب کند. پاسخ Admin به Platform Admin احراز‌شده منتسب است.
- گفت‌وگو به `MessageRequest` یا `VipRequest` وصل نیست و status، ارسال provider، outbox پیام‌رسانی، Customer، Visit و Transaction را تغییر نمی‌دهد.
- نسخهٔ فعلی فقط متن است: بدون فایل، حذف/ویرایش پیام، close/reopen، unread per-user، push، WebSocket یا تحویل بلادرنگ. نشانگر Admin فقط از نویسندهٔ آخرین پیام مشتق و ذخیره می‌شود، نه رسید خواندن.

## داده و تضمین‌ها

- migration جدول‌های جدید را اضافه می‌کند و دادهٔ تاریخی را بازنویسی نمی‌کند. `support_conversations.user_id` یکتا و رابطهٔ کاربر/سالن با foreign key مرکب محدود است؛ پیام نیز با foreign key مرکب به conversation همان سالن و در صورت نویسندهٔ سالن به user همان سالن وصل است. حذف‌های cascade برای این facts وجود ندارد.
- نویسندهٔ پیام دقیقاً یکی از کاربر سالن یا Platform Admin است. متن غیرتهی و حداکثر ۲۰۰۰ نویسه است. پیام‌ها immutable هستند.
- `POST` با `Idempotency-Key` انجام می‌شود. تکرار همان درخواست همان پیام را برمی‌گرداند؛ متن متفاوت با همان کلید conflict است. پیام، زمان آخرین پیام، نشانگر نیاز به پاسخ، claim idempotency و audit metadata در یک transaction ثبت می‌شوند؛ audit متن را حمل نمی‌کند.
- زمان پیام تازه پس از قفل conversation و با دقت میلی‌ثانیه، اکیداً پس از `lastMessageAt` قبلی انتخاب می‌شود. بنابراین نویسندهٔ آخرین commit ترتیب و نشانگر پاسخ را تعیین می‌کند؛ replay تاریخچه یا نشانگر را جابه‌جا نمی‌کند.
- pagination پیام و inbox با ترتیب `(createdAt/lastMessageAt DESC, id DESC)` و صفحه‌های حداکثر ۳۰تایی است. متن فقط به actor مجاز در response پیام برمی‌گردد، نه به فهرست Admin.

## API و UI

- سالن، OWNER/MANAGER/STAFF: `GET /support/conversation` و `POST /support/conversation/messages`.
- Platform Admin: `GET /admin/support/conversations`، `GET /admin/support/conversations/:id` و `POST /admin/support/conversations/:id/messages`.
- Flutter فقط ورودی، تاریخچه و وضعیت‌های loading/empty/error را نمایش می‌دهد. مجوز، مالکیت، idempotency و ترتیب در backend تعیین می‌شوند. Refresh دستی، بازگشت به inbox و پس از ارسال، دادهٔ تازه را می‌خواند.
- Prisma log event در مرز مشترک database تنها فیلدهای allowlisted مانند operation/code/target را چاپ می‌کند. پیام خام خطا، query parameter، connector detail و stack نباید چاپ شوند؛ این رفتار بر دیگر مصرف‌کنندگان `createPrismaClient` نیز اعمال می‌شود و نیازمند regression review است.

## معیار پذیرش و شواهد این شاخه

1. دو کاربر یک سالن گفت‌وگوهای جدا دارند؛ کاربر سالن دیگر به هیچ‌یک دسترسی ندارد؛ Admin با هویت خودش پاسخ می‌دهد.
2. replay کلید ارسال پیام دوم نمی‌سازد و metadata پاسخ را تغییر نمی‌دهد؛ دو اولین ارسال هم‌زمان یک conversation می‌سازند.
3. ارسال‌های قفل‌شده در هر دو ترتیب، chronology و نشانگر «نیاز به پاسخ» صحیح دارند؛ timestamp هم‌میلی‌ثانیه یا clock عقب‌افتاده ترتیب را نمی‌شکند.
4. متن پشتیبانی در request log، audit metadata، idempotency hash و Prisma error output ظاهر نمی‌شود؛ خطای constraint ردیف نامعتبر را persist نمی‌کند.
5. فرستادن پیام پشتیبانی هیچ وضعیت ordinary/VIP یا outbox provider را تغییر نمی‌دهد.
6. Android: کاربر سالن پیام را از «حساب من» می‌فرستد؛ STAFF فقط گفت‌وگوی خودش را می‌بیند؛ Admin inbox و reply را می‌بیند؛ سالن پس از refresh پاسخ را می‌خواند.

گزارش نهایی این برش: support E2E هفت تست، database log چهار تست، typecheck و build API/database، widget tests و walkthrough Android روی PostgreSQL disposable پاس شده‌اند. این شواهد مجوز ادعای rollout پایدار یا پشتیبانی realtime نیستند. retention عملیاتی متن پیش از rollout باید تصمیم‌گیری شود؛ حذف خودکار فعلاً وجود ندارد.

## یادداشت تاریخی

طرح اولیهٔ MA-01 یک `SupportCase` متصل به هر `MessageRequest` یا `VipRequest` با close/reopen بود. تصمیم محصول بعدی آن را کنار گذاشت. آن مدل در این برش ساخته نشده و نباید به‌عنوان قرارداد API، schema یا UI فعلی خوانده شود.
