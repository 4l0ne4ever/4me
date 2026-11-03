# pm/

Đánh giá sản phẩm 4me: báo cáo, bằng chứng và prompt dùng để đánh giá. Không phải code của sản phẩm.

| Đường dẫn | Là gì |
| --- | --- |
| `nghien-cuu-thi-truong.md` | Nghiên cứu thị trường và trả lời "4me có được không", ngày 2026-10-23 (đọc file này trước) |
| `danh-gia-san-pham.md` | Báo cáo đánh giá đầu tiên: 7 mục, kế hoạch kiểm chứng TN1–TN4 |
| `prompt-danh-gia.md` | Khung prompt đánh giá sản phẩm, để chạy lại lần sau |
| `evidence/` | Ảnh chụp dữ liệu công khai của site thật lúc đánh giá |

## evidence/

Lấy ngày 2026-10-23, chỉ đọc, từ các endpoint công khai:

| File | Nguồn | Cho thấy |
| --- | --- | --- |
| `entries-2026-10-23.json` | `GET https://api.2die429.com/entries?limit=100` | 2 trang công khai (`thuyet_duong`, `anarali_yunara`), 4 note |
| `sitemap-2026-10-23.xml` | `GET https://2die429.com/sitemap.xml` | 4 URL, 1 desktop công khai |
| `cat-2026-10-23.json` | `GET https://api.2die429.com/cat` | Bộ đếm Ink: 67 lần vuốt, 15 lần cho cá, 0 lần chơi len |

Theo chủ sản phẩm, mọi tài khoản và trang tại thời điểm này đều của tester, chưa có người dùng thật. Không gồm trang
riêng tư, nháp hay số tài khoản: những số đó chỉ có trong DB. Khi chạy lại đánh giá, lấy lại ba file
này và so sánh.

## Chạy lại

Dán nội dung `prompt-danh-gia.md` vào Claude Code ở thư mục gốc repo, điền phần THÔNG TIN SẢN PHẨM ở cuối (ít nhất mục
tiêu, số người dùng thật trong DB, và đội ngũ/thời gian), rồi lưu báo cáo mới cạnh báo cáo cũ với ngày trong tên file.
