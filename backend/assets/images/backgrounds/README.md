# 🖼️ Thư mục ảnh nền – YUGIOH

Thư mục này chứa **ảnh nền background** của game. **Đã có ảnh** – nền đang hoạt động trên cả 2 trang
(sảnh chính `index.html` và bàn đấu `duel.html`).

## Cấu trúc

```
assets/images/backgrounds/
├── bg-lobby.jpg   ← ⭐ ẢNH NỀN SẢNH CHÍNH   (index.html)  ✅ ĐÃ CÓ – 1796×876, JPG, ~692 KB
├── bg-duel.jpg    ← ⭐ ẢNH NỀN BÀN ĐẤU     (duel.html)   ✅ ĐÃ CÓ – bản sao của ảnh trên
└── README.md
```

> Muốn đổi nền bàn đấu thành ảnh khác: chỉ cần ghi đè `bg-duel.jpg` bằng ảnh mới (giữ nguyên tên),
> không cần sửa code.

## Cách thêm ảnh nền

1. Copy ảnh nền sảnh chính vào `backend/assets/images/backgrounds/` và đặt đúng tên **`bg-lobby.jpg`**.
2. Copy ảnh nền bàn đấu vào `backend/assets/images/backgrounds/` và đặt đúng tên **`bg-duel.jpg`**.
3. Xong. Không cần sửa code – mở trang lên là nền tự đổi.

**Yêu cầu gợi ý:**
- **Định dạng:** `.jpg` hoặc `.webp` (ảnh chụp/tranh nền thì `.jpg` là đủ và nhẹ).
- **Kích thước:** ngang, khuyến nghị **1920×1080** (16:9). Ảnh nhỏ hơn vẫn dùng được nhưng sẽ hơi mờ.
- **Dung lượng:** giữ dưới **~1 MB / ảnh** để web tải nhanh.
- Ảnh sẽ được **phủ kín màn hình** (`background-size:cover`) và **canh giữa**, nên hãy để chi tiết quan trọng
  ở giữa ảnh, tránh sát mép (màn hình dọc sẽ cắt hai bên).
- Code đã tự làm **tối 4 viền** ảnh (vignette) để chữ và nút bấm trên nền vẫn dễ đọc.

**Nếu muốn dùng tên file / đuôi khác** (ví dụ `.png`, `.webp`), sửa **1 chỗ duy nhất** trong `css/theme.css`:
```css
:root{
  --bg-lobby:url("../assets/images/backgrounds/bg-lobby.jpg");   /* ← đổi ở đây */
  --bg-duel :url("../assets/images/backgrounds/bg-duel.jpg");    /* ← và ở đây */
}
```

## Khi chưa có ảnh (cơ chế dự phòng)

Script `js/bg.js` sẽ thử tải ảnh:
- **Chưa có ảnh** → trang giữ nguyên **nền dự phòng** như cũ (nền SVG phong cảnh ở sảnh chính,
  nền gradient xanh ở bàn đấu). Không hiện biểu tượng ảnh lỗi.
- **Đã có ảnh** → tự thêm class `has-bg` vào `<body>`, ẩn nền dự phòng và hiện ảnh nền của bạn.

> **Lưu ý bản quyền:** nên dùng ảnh bạn tự vẽ/ảnh miễn phí bản quyền để tránh rắc rối khi bảo vệ đồ án.