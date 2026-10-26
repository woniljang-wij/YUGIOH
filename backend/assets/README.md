# 🖼️ Thư mục tài nguyên – YUGIOH

Thư mục này chứa các file hình ảnh của game.

## Cấu trúc

```
assets/
├── images/
│   ├── backgrounds/  ← ⭐ ẢNH NỀN (sảnh chính + bàn đấu) – xem README trong đó
│   │   ├── bg-lobby.jpg
│   │   ├── bg-duel.jpg
│   │   └── README.md
│   ├── currency/     ← ẢNH TIỀN TỆ (vàng và gem)
│   │   ├── gold.png
│   │   └── gem.png
│   ├── artwork/      ← ⭐ ẢNH CÁC LÁ BÀI
│   │   ├── Dark Magician.png
│   │   └── ...
│   └── hero/         ← ⭐ ẢNH NHÂN VẬT
│       ├── kaiba-seto.png
│       ├── muto-yugi.png
│       └── jonouchi-katsuya.png
├── music/            ← Nhạc nền và hiệu ứng âm thanh
│   ├── bgm/
│   └── sfx/
├── vendor/three/     ← Three.js cục bộ dùng riêng cho trình xem 3D lá bài trong tiệm
└── README.md
```

> Thư mục này nằm tại `backend/assets/`. Trình duyệt tải ảnh, nhạc và video từ các URL `/assets/...` do Flask phục vụ. Những file cần trình duyệt hiển thị/phát là tài nguyên công khai, không được bảo vệ chỉ bằng cách đặt chúng trong backend.
>
> 📁 **Ảnh nền:** bỏ file vào `backend/assets/images/backgrounds/` (`bg-lobby.jpg` cho sảnh chính,
> `bg-duel.jpg` cho bàn đấu). Chưa có ảnh thì web tự dùng nền dự phòng – xem `backend/assets/images/backgrounds/README.md`.

Trình xem 3D trong cửa sổ nhận bài của tiệm dùng Three.js được lưu cục bộ tại `backend/assets/vendor/three/`; không tải thư viện từ CDN. Mặt trước giữ nguyên giao diện lá bài hiện có; phần khung và mặt sau được vẽ bằng các React renderer trong `frontend/src/renderers/`.

Ảnh tiền tệ dùng chung ở `assets/images/currency/`: `gold.png` cho vàng và `gem.png` cho gem. Các trang sử dụng trực tiếp hai ảnh này thay vì dựng biểu tượng tiền bằng canvas.

## Artwork lá bài – `assets/images/artwork/`

Lưu ảnh minh họa các lá bài trong thư mục này và ghi đường dẫn tương đối vào trường `image` trong `backend/data/cards.json`, ví dụ `assets/images/artwork/Dark%20Magician.png`.

## Ảnh nhân vật – `assets/images/hero/`

Đây là ảnh nhân vật đứng bên trái **sảnh chính**. Code đã trỏ sẵn vào đúng đường dẫn này.
Bạn có thể thêm ảnh nhân vật vào `backend/assets/images/hero/` và đăng ký mã nhân vật cùng đường dẫn trong `frontend/src/pages/LobbyPage.jsx`.

**Yêu cầu gợi ý:**
- **Định dạng:** `.png` **nền trong suốt** (đẹp nhất) — nếu dùng `.jpg` thì nhân vật sẽ có nền vuông.
- **Tỉ lệ:** ảnh **dọc**, tỉ lệ khoảng **2:3** (ví dụ 800×1200 px).
- **Chiều cao khuyến nghị:** 900–1200 px.
- Nhân vật nên **đứng giữa, chân sát mép dưới** của ảnh (code canh ảnh đứng ở mép dưới màn hình).

**Nếu muốn đổi tên file khác**, cập nhật đường dẫn nhân vật trong `frontend/src/pages/LobbyPage.jsx`:
```jsx
{ name: 'Kaiba Seto', image: 'assets/images/hero/kaiba-seto.png' }
```

## Khi chưa có ảnh

Trang web sẽ hiện khung chờ nếu ảnh nhân vật không tải được.
để bạn biết chỗ cần thêm. Khi bạn bỏ ảnh vào, khung đó tự mất và ảnh hiện thay thế.

## Các ảnh khác (sẽ dùng sau)

| File | Dùng cho |
|---|---|
| `assets/avatar.png` | Ảnh đại diện người chơi (khung trên-trái) |
| `assets/logo.png` | Logo game |
| `backend/assets/images/backgrounds/bg-lobby.jpg` | Ảnh nền **sảnh chính** (thay cho nền SVG hiện tại) |
| `backend/assets/images/backgrounds/bg-duel.jpg` | Ảnh nền **bàn đấu** (thay cho nền gradient hiện tại) |

> **Lưu ý bản quyền:** nên dùng ảnh bạn tự vẽ/ảnh miễn phí bản quyền để tránh rắc rối khi bảo vệ đồ án.
