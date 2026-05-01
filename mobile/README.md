# 주문관리 Mobile App

## Cài đặt & Chạy

### Bước 1 — Cài dependencies
```bash
cd "mobile"
npm install
```

### Bước 2 — Cài Expo CLI (nếu chưa có)
```bash
npm install -g expo-cli eas-cli
```

### Bước 3 — Chạy development
```bash
npx expo start --android
```
> Cần cài **Expo Go** trên điện thoại Android, scan QR code là dùng được

### Bước 4 — Build APK (cài trực tiếp không cần Play Store)
```bash
# Đăng ký tài khoản Expo (miễn phí) tại expo.dev
eas login
eas build --platform android --profile preview
```
> File APK sẽ được download về, cài trực tiếp lên Samsung là xong

## Luồng sử dụng app
1. **HomeScreen** → Danh sách khách hàng từ Supabase
2. **OrderScreen** → Tick chọn các mặt hàng cần xuất kho
3. **CameraScreen** → Scan barcode 송장 tự động → Chụp ảnh
4. **MessageScreen** → Preview tin nhắn → Gửi SMS hoặc KakaoTalk
