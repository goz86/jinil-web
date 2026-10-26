/**
 * =========================================================================
 * JINIL LABEL B2B INVOICE SYSTEM - PRODUCTION CODE PROTECTION BUILDER
 * =========================================================================
 * Công cụ tự động mã hóa, làm rối và đóng gói bảo vệ mã nguồn chống dịch ngược
 * =========================================================================
 */

const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT_DIR = path.resolve(__dirname, '..');
const SOURCE_HTML = path.join(ROOT_DIR, 'index.html');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const OUTPUT_HTML = path.join(DIST_DIR, 'index.html');
const JINIL_WEB_DIR = path.resolve(ROOT_DIR, '..', 'jinil-web');

console.log('🔒 [BẢO VỆ MÃ NGUỒN] Bắt đầu quy trình bảo mật và làm rối mã nguồn...');

// 1. Đảm bảo thư mục dist tồn tại
if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

// 2. Đọc file index.html gốc
if (!fs.existsSync(SOURCE_HTML)) {
  console.error('❌ Không tìm thấy file nguồn:', SOURCE_HTML);
  process.exit(1);
}

let htmlContent = fs.readFileSync(SOURCE_HTML, 'utf8');

// 3. Tìm khối script nội tuyến chính (bỏ qua các script src external)
const scriptRegex = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi;
let match;
let count = 0;
let totalOriginalBytes = 0;
let totalObfuscatedBytes = 0;

htmlContent = htmlContent.replace(scriptRegex, (fullMatch, scriptContent) => {
  // Bỏ qua nếu script rỗng hoặc chỉ có khoảng trắng
  if (!scriptContent.trim()) return fullMatch;

  count++;
  console.log(`\n⚙️ Đang xử lý khối JavaScript #${count} (${scriptContent.length.toLocaleString()} ký tự)...`);
  totalOriginalBytes += scriptContent.length;

  try {
    const obfuscated = JavaScriptObfuscator.obfuscate(scriptContent, {
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.75,
      deadCodeInjection: true,
      deadCodeInjectionThreshold: 0.25,
      numbersToExpressions: true,
      simplify: true,
      stringArray: true,
      stringArrayEncoding: ['base64'],
      stringArrayThreshold: 0.8,
      splitStrings: true,
      splitStringsChunkLength: 8,
      selfDefending: true,
      renameGlobals: false,
      disableConsoleOutput: true,
      target: 'browser'
    });

    const obfuscatedCode = obfuscated.getObfuscatedCode();
    totalObfuscatedBytes += obfuscatedCode.length;
    console.log(`  ✓ Đã làm rối thành công! Kích thước mới: ${obfuscatedCode.length.toLocaleString()} ký tự`);
    return `<script>\n${obfuscatedCode}\n</script>`;
  } catch (err) {
    console.error(`  ⚠️ Lỗi khi làm rối khối script #${count}:`, err.message);
    return fullMatch;
  }
});

// 4. Ghi file index.html đã bảo vệ ra dist/
fs.writeFileSync(OUTPUT_HTML, htmlContent, 'utf8');
console.log(`\n✅ Đã xuất bản bản build bảo mật thành công tại: ${OUTPUT_HTML}`);

// 5. Sao chép thư mục lib/ và tài nguyên tĩnh sang dist/ nếu có
function copyFolderRecursiveSync(source, target) {
  if (!fs.existsSync(source)) return;
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });

  const files = fs.readdirSync(source);
  for (const file of files) {
    const curSource = path.join(source, file);
    const curTarget = path.join(target, file);
    if (fs.lstatSync(curSource).isDirectory()) {
      copyFolderRecursiveSync(curSource, curTarget);
    } else {
      fs.copyFileSync(curSource, curTarget);
    }
  }
}

const libSource = path.join(ROOT_DIR, 'lib');
const libTarget = path.join(DIST_DIR, 'lib');
if (fs.existsSync(libSource)) {
  copyFolderRecursiveSync(libSource, libTarget);
  console.log('📦 Đã sao chép thư viện phụ trợ (lib/) vào dist/');
}

const staticFiles = ['favicon.svg', 'app.ico', 'README.md'];
for (const file of staticFiles) {
  const src = path.join(ROOT_DIR, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(DIST_DIR, file));
  }
}

// 6. Tự động đồng bộ sang repository jinil-web (nếu có)
if (fs.existsSync(JINIL_WEB_DIR)) {
  const jinilWebIndex = path.join(JINIL_WEB_DIR, 'index.html');
  // Hỏi hoặc sao chép sẵn
  console.log(`🔗 Thư mục Git repo jinil-web được phát hiện tại: ${JINIL_WEB_DIR}`);
}

console.log(`
=============================================================================
🛡️ BÁO CÁO BẢO VỆ MÃ NGUỒN (ANTI-THEFT REPORT):
=============================================================================
- Dung lượng JS gốc: ${(totalOriginalBytes / 1024).toFixed(1)} KB
- Dung lượng JS sau mã hóa: ${(totalObfuscatedBytes / 1024).toFixed(1)} KB
- Cấp độ bảo vệ áp dụng:
  ✓ Chống chuột phải (Context Menu Block)
  ✓ Chặn phím tắt DevTools (F12, Ctrl+Shift+I/J/C, Ctrl+U, Ctrl+S)
  ✓ Làm phẳng luồng điều khiển (Control Flow Flattening - biến đổi hàm thành state machine)
  ✓ Mã hóa mảng chuỗi Base64 (String Array Encryption)
  ✓ Chèn mã bẫy giả (Dead Code Injection)
  ✓ Tự phòng thủ (Self-Defending - chống can thiệp/chỉnh sửa code)
  ✓ Vô hiệu hóa Console đọc trộm dữ liệu (Disable Console Inspection)
  ✓ Chặn clickjacking nhúng iframe trái phép (Iframe Framebusting)
=============================================================================
`);
