# tester/

QA của 4me: báo cáo, bằng chứng và các script để chạy lại. Không phải code của sản phẩm; không thay đổi gì trong `apps/`.

| Đường dẫn | Là gì |
| --- | --- |
| `BAO-CAO-QA.md` | Báo cáo QA (đọc file này trước) |
| `repro/` | Tái hiện lỗi ở tầng API trên PGlite trong bộ nhớ. Không chạm DB hay dịch vụ thật |
| `e2e/` | Kiểm thử trên website thật bằng Chrome headless (giao thức DevTools, không cần cài thêm gì) |
| `evidence/` | Ảnh chụp và kết quả JSON của các lần chạy ngày 2026-10-23 |
| `fixtures/photo.jpg` | Ảnh mẫu để thử upload |

## Chạy lại

```bash
# Tái hiện ở tầng API (an toàn, chạy local)
bash tester/repro/run.sh

# Trên website (mặc định https://2die429.com; đặt SITE/API để trỏ sang local hoặc staging).
# Mật khẩu chỉ truyền qua biến môi trường, không bao giờ ghi vào file.
TESTER_EMAIL=… TESTER_PASSWORD=… node tester/e2e/member.mjs     # một thành viên + một khách
TESTER_EMAIL=… TESTER_PASSWORD=… node tester/e2e/focus.mjs      # thư niêm phong, blast, note live
A_EMAIL=… A_PASSWORD=… B_EMAIL=… B_PASSWORD=… node tester/e2e/cross.mjs   # hai thành viên
node tester/e2e/site.mjs                                         # /admin, giao diện điện thoại, thời gian tải
```

Cần lưu ý:

- Mỗi thành viên chỉ được tạo **10 trang mỗi ngày**, tính theo ngày UTC (07:00 giờ VN). Lần lưu thất bại và trang đã xoá đều bị tính. `member.mjs` tạo khoảng 4 trang, `focus.mjs` 2 trang, `cross.mjs` 2 trang.
- Script tự xoá mọi trang có tiêu đề `[QA] …` khi kết thúc. Những thứ không xoá được bằng app: tin nhắn `[QA]` trong cuộc trò chuyện giữa hai tài khoản test (cuộc trò chuyện hai người không thể xoá) và các thông báo.
- `site.mjs` gửi 10 mật khẩu admin sai hiển nhiên để kiểm tra giới hạn số lần thử. Script không đoán mật khẩu thật.
- Đăng ký tài khoản mới và các thao tác ghi của khách (note, guestbook, report) bị Turnstile chặn trong trình duyệt headless. Đây là hành vi đúng.
