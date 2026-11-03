# Báo cáo QA: 4me (2die429.com)

Ngày 2026-10-23 · commit `384888f` (main), có thay đổi chưa commit ở `apps/web/app/globals.css` và `scripts/load-test.js` · môi trường: production (chủ hệ thống cho phép) và local (PGlite).

## A. Phạm vi và mức độ tin cậy

| Hạng mục | Cách làm | Kết quả |
| --- | --- | --- |
| Test có sẵn | `turbo run test --force` (không dùng cache), chạy trên PGlite trong bộ nhớ | **193/193 pass** |
| Typecheck / Lint | `pnpm typecheck`, `pnpm lint` | Typecheck pass. Lint **fail**, chỉ do `scripts/load-test.js` (F8) |
| Review code | Toàn bộ route API; phần auth/session/OAuth/admin phía web; cron email | 16 phát hiện (mục B) |
| Tái hiện ở tầng API | `repro/repro.test.ts` (6 case) | 6/6 hành vi nghi ngờ tái hiện được |
| E2E trên production | Chrome headless với 2 tài khoản test (`valeria`, `hdiu`) và một trình duyệt khách | Khoảng 75 kiểm tra; kết quả trong `evidence/*.json` |

**Chưa kiểm tra được:**
- Đăng ký tài khoản và các thao tác ghi của khách (bị Turnstile chặn, đúng thiết kế).
- Google OAuth thật.
- Gửi email thật (digest, xác minh, reset).
- Moderator sau khi đăng nhập (không có `ADMIN_PASSWORD`).
- Ink, nhạc/YouTube, screensaver, khả năng dùng bằng bàn phím và trình đọc màn hình.
- Tải lớn (không chạy, theo giới hạn phạm vi).

**Mức độ tin cậy:**
- Logic API và các luồng chính của thành viên: **cao**.
- UI ngoài các luồng đã chạy: **trung bình–thấp**.

### Những gì chạy tốt (đã xác nhận trên production)

| Kiểm tra | Kết quả |
| --- | --- |
| Đăng nhập, `/me`, đăng xuất mọi thiết bị (phiên cũ mất quyền ghi ngay) | PASS (M-01, X-09) |
| Trang riêng tư không đọc được với khách; chuyển public sang private có hiệu lực ngay (API, HTML, trang chủ, RSS) | PASS (M-04, M-08) |
| Markup an toàn: `<script>`, `onerror`, link `javascript:` không chạy; link ngoài có `noopener noreferrer nofollow ugc` | PASS (M-07) |
| Nội dung thư niêm phong không lộ ở API, HTML, danh sách, archive, search, lines, RSS | PASS (F-11c) |
| Phân quyền chéo: B không xoá/sửa/mở được trang của A, không sửa/xoá được reply của A, không duyệt được note trên trang A, không đọc được hội thoại không tham gia | PASS (X-05, X-07e) |
| Note, reply và thông báo đúng người nhận; note có link bị giữ lại chờ chủ trang duyệt | PASS (X-03, X-04) |
| Chặn khỏi diary (note + guestbook) và mở chặn; chặn/mở chặn trong Messenger | PASS (X-06, X-07) |
| Report: không tự report trang của mình; 1 report không ẩn trang | PASS (X-08) |
| Bấm Lưu 2 lần chỉ tạo 1 trang; địa chỉ trang trùng bị từ chối rõ ràng; bản nháp chưa lưu được khôi phục sau khi tải lại | PASS (M-12, M-13 bản B, M-14) |
| Note và reaction tới trang khách đang mở theo thời gian thực | PASS (F-09: 3/3) |
| Giao diện điện thoại: không có thanh cuộn ngang | PASS (S-02) |

## B. Phát hiện (nặng trước)

Trạng thái xác minh:
- **[Prod]** đã xác nhận bằng thực thi trên production.
- **[Local]** đã xác nhận bằng thực thi trên PGlite.
- **[Code]** đã xác nhận bằng phân tích code, chưa chạy.
- **[Nghi ngờ]** cần kiểm chứng thêm.

### F1. Google đăng nhập vào tài khoản do người khác tạo trước bằng email chưa xác minh (chiếm tài khoản từ trước). High · P1 · [Local] + [Code]

- **Các bước** (`repro` QA-3):
  1. Kẻ tấn công đăng ký `victim@gmail.com` kèm mật khẩu của họ và không xác minh email.
  2. Chủ thật của email chọn "Continue with Google".
- **Thực tế:** cùng một tài khoản; mật khẩu của kẻ tấn công vẫn dùng được; `sessionVersion` không đổi nên phiên của kẻ tấn công vẫn sống; tên hiển thị là của kẻ tấn công.
- **Ảnh hưởng:** nạn nhân viết nhật ký riêng tư và nhắn tin trong một tài khoản mà kẻ tấn công vẫn đọc được.
- **Bằng chứng:** `apps/api/src/routes/internal.ts:296-305`. Callback ở `apps/web/app/auth/google/callback/route.ts` truyền nguyên `email_verified`.
- **Sửa:** nếu `existing.emailVerified === false`, hoặc từ chối liên kết (yêu cầu đăng nhập bằng mật khẩu trước), hoặc xoá `passwordHash` và tăng `sessionVersion`.
- **Kiểm tra lại:** QA-3.

### F2. `/admin` không giới hạn số lần thử mật khẩu; phiên admin không thu hồi được. Medium · P1 · [Prod]

- **Thực tế:** 10 lần sai liên tiếp, mỗi lần khoảng 260 ms, không có giới hạn hay khoá tạm (S-01). Tốc độ thử chỉ bị giới hạn bởi độ trễ mạng.
- **Bằng chứng:**
  - `apps/web/app/admin/actions.ts:17`: không có rate-limit hay Turnstile.
  - `apps/web/lib/session.ts`: cookie stateless 14 ngày, chỉ thu hồi được bằng cách đổi `ADMIN_SESSION_SECRET`.
- **Sửa:** rate-limit theo IP (dùng lại `rateHits` qua API), thêm độ trễ tăng dần, cân nhắc thêm session version cho admin.
- **Kiểm tra lại:** S-01 phải gặp giới hạn trước lần thứ 10.

### F3. Trang chuyển từ nháp/riêng tư sang công khai không được thông báo cho ai. Medium · P2 · [Prod] + [Local]

- **Thực tế:**
  - B đang theo dõi A; A đăng một bản nháp lên công khai; chuông của B có 0 thông báo `post`.
  - Tonight của khách đang mở không nhận được trang đó (M-06c, X-02). Trong khi đó trang tạo mới công khai thì có thông báo và hiện live (X-01c).
- **Bằng chứng:** chỉ `POST` (`internal.ts:754`) gọi `publish`/`notify`; `PUT` (`internal.ts:778`) không gọi.
- **Sửa:** thêm `publishedAt`, gán lần đầu trang vừa public vừa không còn niêm phong; Tonight, chuông và email đều dựa vào trường này.

### F4. Email buổi sáng lọc theo `writtenAt`: bỏ sót thư niêm phong đã mở, trang ghi lùi ngày, nháp đăng muộn. Medium–Low · P2 · [Local]

- **Thực tế:** thư viết 30 ngày trước, vừa mở: chuông báo `opened` nhưng digest không có trang nào (QA-2). Nháp viết 3 ngày trước, đăng hôm nay: digest = 0 (QA-1).
- **Bằng chứng:** `apps/api/src/routes/mail.ts:102`.
- **Sửa:** cùng hướng với F3.

### F5. Ảnh vẫn được phục vụ sau khi xoá trang. Medium · P2 · [Prod]

- **Thực tế:** sau khi xoá trang, URL ảnh vẫn trả 200, `cf-cache-status: HIT`, `age` khoảng 150 s. Lặp lại ở cả 3 lần chạy (M-92).
- **Kỳ vọng:** README viết "Deleting a page, or an account, deletes its photos".
- **Bằng chứng:**
  - `apps/api/src/routes/media.ts:71`: `public, max-age=31536000, immutable`.
  - `media.ts:79`: `cache.put` vào edge cache.
  - Không có `cache.delete` nào trong code.
- **Ảnh hưởng:** ai đã có URL (người từng xem trang, crawler, ứng dụng chat đã tạo preview) vẫn tải được ảnh tới 1 năm. Ngoài ra, ảnh của trang riêng tư cũng tải được bởi bất kỳ ai có URL (M-05). URL khó đoán nên đây là đánh đổi chấp nhận được, nhưng nên ghi rõ.
- **Sửa:** `caches.default.delete` theo URL khi xoá; giảm `max-age` và bỏ `immutable`; với trang riêng tư, cân nhắc phục vụ ảnh có kiểm tra quyền.

### F12. Thư niêm phong lộ mood và weather trước ngày mở. Medium–Low · P2 · [Prod] + [Local]

- **Thực tế:**
  - Nội dung thư được che kín.
  - Nhưng `mood` và `weather` hiện ở 6 chỗ: `GET /entries/by`, `/entries?author`, danh sách trang chủ, `/entries/latest`, HTML trang đọc, HTML trang diary (F-11d, QA-6).
  - Riêng `/archive` thì che mood.
- **Kỳ vọng:** comment trong code: "While it is a sealed letter only its title, writer and dates show" (`apps/api/src/lib/map.ts`). `/archive` cũng đã che mood.
- **Bằng chứng:** `toSummary` trong `apps/api/src/lib/map.ts` trả `mood`/`weather` mà không kiểm tra `sealed`.
- **Sửa:** che `mood`/`weather` khi `sealed && !reveal`. Kiểm tra lại bằng F-11d.

### F6. Người được thêm vào nhóm chat đọc được toàn bộ lịch sử trước đó. Medium/Low (tuỳ yêu cầu) · P3 · [Local]

- QA-4: người mới thấy cả tin nhắn gửi trước khi họ vào. `apps/api/src/routes/chat.ts:264` không lọc theo `joinedAt`.
- Ai trong nhóm cũng thêm được người khác mà không cần người đó đồng ý.
- Cần chốt yêu cầu.

### F13. App báo "you've been signed out" khi lỗi thực ra là lỗi API tạm thời. Low–Medium · P3 · [Prod, 1 lần] + [Code]

- **Thực tế:** giữa phiên chạy, việc lưu trang trả về "you've been signed out, sign in again" (M-13 với tài khoản A). Các bước ngay sau vẫn chạy được với chính phiên đó. 40 lần gọi `/me` liên tiếp sau đó không lặp lại lỗi.
- **Nguyên nhân:** `getMe()` (`apps/web/lib/auth.ts`) `catch` mọi lỗi của `internalApi` và trả `null`. Lỗi mạng, lỗi 5xx hay rate-limit đều bị hiển thị thành "đã đăng xuất".
- **Ảnh hưởng:** người dùng tưởng mất phiên và có thể bỏ dở trang đang viết. Bản nháp chưa lưu vẫn được giữ trong trình duyệt, nên đây là lỗi Low–Medium.
- **Sửa:** chỉ trả `null` khi token không hợp lệ hoặc API trả 404; các lỗi khác báo "không kết nối được, thử lại".
- **Kiểm chứng tiếp:** xem `/admin` → Errors lúc khoảng 15:38 (giờ VN) ngày 23/10.

### F14. Hạn mức 10 trang mỗi ngày tính cả lần lưu thất bại và trang đã xoá. Low · P3 · [Prod]

- B gặp "that's ten pages today already" trong khi trên diary không có trang nào. Các lần trùng địa chỉ (409) và trang đã xoá vẫn bị tính.
- **Bằng chứng:** `internal.ts` `POST /users/:id/entries` gọi `allowKey` trước khi kiểm tra dữ liệu.
- **Sửa:** chỉ tính sau khi insert thành công; thông báo nói rõ lúc nào hạn mức được làm mới (07:00 giờ VN).

### F15. "Read me.txt" che mất trang được chia sẻ trong lần ghé đầu tiên trên desktop. Low · P3 · [Prod]

- Khách mở link trực tiếp tới một trang thì cửa sổ Read me nằm đè lên giữa nội dung (`evidence/f11-sealed-letter-as-guest.png`).
- **Sửa:** không tự mở Read me khi URL là một trang cụ thể, hoặc mở ở góc hay thu nhỏ.

### F16. Thông báo lỗi khi tiêu đề trống là chuỗi kỹ thuật của zod. Low · P3 · [Prod]

- Hiển thị "Too small: expected string to have >=1 characters" (M-02), không nói là trường nào, không gợi ý cách sửa.
- **Sửa:** đặt message riêng cho `entryInput` (ví dụ "Give the page a title").

### F7. Chủ trang mở lại được note đã bị 3 người report; chỉ cần 1 report nữa là ẩn lại. Low · P3 · [Local]

- QA-5: `hidden → visible → hidden`. `internal.ts:897` cho đặt `visible` mà không xoá `note_reports`.

### F8. Lint fail vì `scripts/load-test.js`, và script này mặc định nhắm vào production. Low · P2 trước khi commit · [Prod-local]

- Nếu commit file này, CI (`pnpm lint`) fail và deploy bị chặn.
- Mặc định `SITE=https://2die429.com`; nên đổi mặc định sang localhost.

### F9. Cron email buổi sáng dễ timeout và gửi trùng khi có nhiều người nhận. Medium khi có quy mô lớn · [Nghi ngờ]

- `mail.ts:79` giới hạn 500 người và không sắp thứ tự.
- Gửi tuần tự trong `maxDuration = 60`. Nếu timeout, `/digests/sent` không được gọi và hôm sau người nhận nhận lại trang cũ.

### F10. Các thao tác nhiều bước không nằm trong transaction. Low · [Nghi ngờ]

- Xoá tài khoản xoá ảnh trước (`internal.ts:406`), rồi mới xoá DB bằng nhiều câu lệnh rời.

### F11. Giới hạn 10 lần đăng nhập / 15 phút / email đếm cả lượt của người khác. Low · [Code]

- Ai biết email của người khác cũng có thể liên tục khoá đăng nhập bằng mật khẩu của họ (sign-in không có Turnstile).

### Hiệu năng (quan sát, không phải kết luận về tải)

- Server action (lưu trang, note...) mất **1,5–3 s** trong các lần E2E. `/me` lúc rảnh có p50 khoảng 177 ms.
- Mỗi action gọi API ít nhất 2 lần (`getMe` rồi thao tác thật), web ở `sin1` và API ở Workers/Neon. Nên đo tiếp bằng log thời gian ở phía server.
- Trang `/u/hdiu` lần tải đầu mất 2,1 s, các lần sau khoảng 110 ms (cache).

## C. Còn thiếu

| Phần | Lý do | Cách làm |
| --- | --- | --- |
| Moderator sau khi đăng nhập (ẩn/hiện trang, suspend, duyệt note, lên kế hoạch đêm) | Không có `ADMIN_PASSWORD` | Chạy local với `.env.local`, hoặc cấp quyền tạm |
| Thao tác của khách (note, guestbook, poem, report qua Turnstile) | Turnstile chặn headless | Thử tay, hoặc dùng staging với site key test của Turnstile |
| Email (xác minh, reset, digest) | Không gửi email thật | Staging với Resend test, hoặc mock |
| F1 trên production | Cần đăng ký bằng email của người khác | Thử trên staging với 2 hộp thư test |
| Xoá tài khoản, đổi mật khẩu, đổi địa chỉ diary | Sẽ phá tài khoản test | Tạo tài khoản dùng một lần trên staging |
| Chặn khách theo hash IP (CGNAT ở mạng di động VN) | Rủi ro thiết kế: dễ chặn nhầm người khác và dễ lách | Cần quyết định sản phẩm |

**Dữ liệu test còn lại trên production:**
- Cuộc trò chuyện `valeria`–`hdiu` với 3 tin `[QA]` (app không cho xoá cuộc trò chuyện hai người).
- Thông báo trong 2 tài khoản test.
- Ảnh đã upload của các lần lưu thất bại: app tự dọn sau 1 ngày, nhưng chỉ khi tài khoản đó upload ảnh tiếp.
- 10 lần đăng nhập admin sai.
- Hạn mức trang hôm nay của cả 2 tài khoản đã dùng gần hết.

## D. Kết luận phát hành

**Có thể phát hành có điều kiện.**
- Các luồng chính chạy đúng trên production.
- Phân quyền chéo và quyền riêng tư của nội dung trang được bảo vệ tốt.
- **Điều kiện:** sửa F1 (Google đang bật) và F2 sớm nhất có thể.
- F5 và F12 là hai chỗ mà lời hứa về quyền riêng tư trong README/code chưa đúng với thực tế, nên sửa trong lần phát hành tới.
- Độ tin cậy: cao với API và các luồng thành viên đã chạy; trung bình với phần còn lại.

## E. Ba việc nên làm tiếp

1. **Sửa F1 và F2.** Xong khi QA-3 cho thấy từ chối liên kết hoặc mật khẩu cũ mất hiệu lực, và S-01 gặp giới hạn trước lần thứ 10. Mỗi lỗi có test hồi quy.
2. **Thực hiện đúng lời hứa riêng tư (F5, F12).** Xong khi M-92 trả 404 sau khi xoá và F-11d không còn thấy mood/weather.
3. **Thêm `publishedAt` (F3, F4).** Xong khi X-02, QA-1 và QA-2 đều có chuông, Tonight live và digest, và không báo trùng khi sửa trang.
