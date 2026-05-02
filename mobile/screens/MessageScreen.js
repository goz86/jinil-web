import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Image, Share, Linking, Alert, Platform, ActivityIndicator,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import * as Print from 'expo-print';
import * as ImageManipulator from 'expo-image-manipulator';
import * as SMS from 'expo-sms';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { supabase, fmt, BUCKETS, uploadFile, C } from '../lib/supabase';

// ── Compress image before upload ──────────────────────
// Target: max 1080px wide, quality 0.72 → ~150-300KB from a 3-5MB camera photo
async function compressImage(uri) {
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1080 } }],   // shrink to 1080px max width (keeps ratio)
      { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG }
    );
    return result.uri;
  } catch (e) {
    console.warn('Compress error:', e.message);
    return uri; // fallback to original if compression fails
  }
}

// ── Fetch supplier info from Supabase settings table ──
async function fetchSupplier() {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'supplier')
      .maybeSingle();
    if (!error && data?.value) return data.value;
  } catch (e) { }
  return {}; // fallback: empty supplier
}

// ── Message builder ───────────────────────────────────
function buildMessage({ customer, items, trackingNo, pdfUrl, shipDate }) {
  // Auto-detect carrier: Kyunggi Express for 16 chars, Lotte otherwise
  const isKyunggi = (trackingNo && trackingNo.length === 16);
  const carrier = isKyunggi ? '경기택배' : '롯데택배';

  const itemLines = items
    .map((i, n) => `           ${n + 1}. ${i.name}${i.spec ? ` (${i.spec})` : ''} × ${i.qty}개`)
    .join('\n');

  return `[출고 알림]
안녕하세요, ${customer.name} 고객님.
주문하신 상품이 금일(${shipDate}) 출고되었습니다.

🚚 택배 정보
택배사: ${carrier}
📦 송장번호: ${trackingNo || '(확인 중)'}

 품목명 :
${itemLines}

📑 거래명세서: ${pdfUrl || ''}
📅 출고일: ${shipDate}
감사합니다.`;
}

// ── Invoice HTML ──────────────────────────────────────
function generateInvoiceHTML(customer, items, shipDate, supplier = {}) {
  const total = items.reduce((s, i) => s + (i.qty || 0) * (i.price || 0), 0);
  const [yr, mo, dy] = shipDate.split('-');

  const rows = Array.from({ length: 14 }).map((_, i) => {
    const it = items[i];
    if (it) {
      return `<tr>
        <td>${mo}</td><td>${dy}</td>
        <td style="text-align:left;padding-left:6px">${it.name}${it.spec ? ` (${it.spec})` : ''}</td>
        <td></td><td>${it.qty}</td>
        <td style="text-align:right">${fmt(it.price)}</td>
        <td style="text-align:right">${fmt(it.qty * it.price)}</td>
        <td></td><td></td>
      </tr>`;
    }
    return `<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
  }).join('');

  const css = `
    @page { size: A4 landscape; margin: 0; }
    * { box-sizing: border-box; }
    body { font-family: sans-serif; margin: 0; padding: 8mm; background:#fff; }
    .wrap { display:flex; width:100%; border:2px solid #1a6b3a; height:182mm; }
    .copy { flex:1; padding:10px; border-right:2px solid #1a6b3a; position:relative; display:flex; flex-direction:column; }
    .copy:last-child { border-right:none; }
    .side { position:absolute; right:0; top:0; bottom:0; width:28px; border-left:2px solid #1a6b3a; display:flex; flex-direction:column; align-items:center; justify-content:center; background:#f0fdf4; }
    .side-title { writing-mode:vertical-rl; font-size:15pt; font-weight:700; color:#1a6b3a; letter-spacing:4px; }
    .side-label { writing-mode:vertical-rl; font-size:7pt; color:#555; margin-top:8px; }
    .parties { display:flex; gap:4px; margin-right:32px; margin-bottom:4px; }
    .party { flex:1; border:1px solid #1a6b3a; }
    .party-title { background:#e8f5e8; color:#1a6b3a; font-weight:700; text-align:center; font-size:9pt; padding:3px 0; border-bottom:1px solid #1a6b3a; }
    .party-row { display:flex; border-bottom:1px solid #c5e0c5; min-height:16px; }
    .party-row:last-child { border-bottom:none; }
    .party-lbl { width:55px; padding:2px 4px; border-right:1px solid #c5e0c5; color:#555; font-size:7pt; background:#f9fdf9; text-align:center; }
    .party-val { flex:1; padding:2px 5px; font-size:7.5pt; }
    .bank-bar { display:flex; align-items:center; margin-right:32px; margin-bottom:4px; border:1.5px solid #1a6b3a; background:#fffbe6; font-size:8pt; }
    .bank-lbl { padding:4px 10px; border-right:1.5px solid #1a6b3a; font-weight:700; color:#1a6b3a; background:#e8f5e8; white-space:nowrap; }
    .bank-val { padding:4px 12px; font-weight:600; color:#1d1d1f; }
    table { width:calc(100% - 32px); border-collapse:collapse; font-size:7.5pt; margin-top:4px; border:1px solid #1a6b3a; }
    th { background:#e8f5e8; color:#1a6b3a; border:1px solid #1a6b3a; padding:4px 3px; font-size:7.5pt; }
    td { border:1px solid #d4e8d4; padding:3px 3px; text-align:center; }
    .total { display:flex; border:1.5px solid #1a6b3a; margin-top:6px; width:calc(100% - 32px); }
    .total-lbl { background:#e8f5e8; color:#1a6b3a; font-weight:700; padding:5px 12px; border-right:1.5px solid #1a6b3a; font-size:10pt; }
    .total-val { flex:1; padding:5px 12px; text-align:right; font-weight:700; font-size:10pt; }
  `;

  const copyHtml = (label) => `
    <div class="copy">
      <div style="font-size:6.5pt;color:#888;margin-bottom:2px">${yr}년 ${mo}월 ${dy}일</div>
      <div class="parties">
        <div class="party">
          <div class="party-title">공 급 자</div>
          <div class="party-row"><div class="party-lbl">등록번호</div><div class="party-val">${supplier['sup-biz'] || ''}</div></div>
          <div class="party-row"><div class="party-lbl">상 호</div><div class="party-val" style="font-weight:700">${supplier['sup-name'] || ''}</div></div>
          <div class="party-row"><div class="party-lbl">성 명</div><div class="party-val">${supplier['sup-rep'] || ''}</div></div>
          <div class="party-row"><div class="party-lbl">주 소</div><div class="party-val">${supplier['sup-addr'] || ''}</div></div>
          <div class="party-row"><div class="party-lbl">업 태</div><div class="party-val">${supplier['sup-biz-type'] || ''}</div></div>
          <div class="party-row"><div class="party-lbl">종 목</div><div class="party-val">${supplier['sup-item-type'] || ''}</div></div>
          <div class="party-row"><div class="party-lbl">Tel</div><div class="party-val">${supplier['sup-tel'] || ''}</div></div>
        </div>
        <div class="party">
          <div class="party-title">공 급 받 는 자</div>
          <div class="party-row"><div class="party-lbl">등록번호</div><div class="party-val">${customer.biz_no || ''}</div></div>
          <div class="party-row"><div class="party-lbl">상 호</div><div class="party-val" style="font-weight:700">${customer.name}</div></div>
          <div class="party-row"><div class="party-lbl">성 명</div><div class="party-val">${customer.rep || ''}</div></div>
          <div class="party-row"><div class="party-lbl">주 소</div><div class="party-val">${customer.addr || ''}</div></div>
          <div class="party-row"><div class="party-lbl">업 태</div><div class="party-val"></div></div>
          <div class="party-row"><div class="party-lbl">종 목</div><div class="party-val"></div></div>
          <div class="party-row"><div class="party-lbl">Tel</div><div class="party-val">${customer.tel || ''}</div></div>
        </div>
      </div>
      ${supplier['sup-bank'] ? `
      <div class="bank-bar">
        <div class="bank-lbl">입금 계좌</div>
        <div class="bank-val">${supplier['sup-bank']}</div>
      </div>` : ''}
      <table>
        <thead><tr><th>월</th><th>일</th><th>품목명</th><th>규격</th><th>수량</th><th>단가</th><th>공급가액</th><th>세액</th><th>비고</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="total">
        <div class="total-lbl">합 계</div>
        <div class="total-val">${fmt(total)}원</div>
      </div>
      <div class="side">
        <div class="side-title">거래명세서</div>
        <div class="side-label">(${label})</div>
      </div>
    </div>
  `;

  return `<html><head><meta charset="utf-8"><style>${css}</style></head>
    <body><div class="wrap">${copyHtml('공급받는자용')}${copyHtml('공급자용')}</div></body></html>`;
}

// ── Send option button ────────────────────────────────
function SendBtn({ emoji, label, sub, color = C.blue, onPress, disabled }) {
  return (
    <TouchableOpacity
      style={[styles.sendBtn, disabled && styles.sendBtnDisabled]}
      onPress={onPress}
      activeOpacity={0.75}
      disabled={disabled}
    >
      <View style={[styles.sendBtnIcon, { backgroundColor: color + '18' }]}>
        <Text style={styles.sendBtnEmoji}>{emoji}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.sendBtnLabel, { color: disabled ? C.inkLight : color }]}>{label}</Text>
        <Text style={styles.sendBtnSub}>{sub}</Text>
      </View>
      <Text style={[styles.sendBtnArrow, { color: disabled ? C.inkLight : color }]}>›</Text>
    </TouchableOpacity>
  );
}

// ── Main ──────────────────────────────────────────────
export default function MessageScreen({ route, navigation }) {
  const { customer, items, orderIds, trackingNo, photoUri, shipDate } = route.params;

  const [step, setStep] = useState('processing'); // 'processing' | 'ready'
  const [pdfUrl, setPdfUrl] = useState(null);
  const [imgUrl, setImgUrl] = useState(null);
  const [stepMsg, setStepMsg] = useState('PDF 생성 중...');
  const [sent, setSent] = useState(false);

  useEffect(() => { processAssets(); }, []);

  const processAssets = async () => {
    try {
      // 1. Fetch supplier info from Supabase
      setStepMsg('공급자 정보 불러오는 중...');
      const supplier = await fetchSupplier();

      // 2. Generate PDF
      setStepMsg('거래명세서 PDF 생성 중...');
      const html = generateInvoiceHTML(customer, items, shipDate, supplier);
      const { uri: pdfUri } = await Print.printToFileAsync({ html, base64: false });

      // 3. Upload PDF — Named as "jinil_Date.pdf" to avoid encoding issues
      setStepMsg('PDF 업로드 중...');
      const dateStr = shipDate.replace(/-/g, '');               // 20260501
      const ts      = Math.floor(Date.now() / 1000) % 10000;    // short ts to allow multiple daily shipments
      const pdfPath = `jinil_${dateStr}_${ts}.pdf`;
      const rawUrl  = await uploadFile(BUCKETS.invoices, pdfPath, pdfUri);
      const viewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(rawUrl)}`;
      setPdfUrl(viewerUrl);

      // 4. Compress + upload photo — unique filename prevents overwriting previous entries
      if (photoUri) {
        setStepMsg('사진 압축 및 업로드 중...');
        const compressedUri = await compressImage(photoUri);   // ~150-300KB
        const imgPath = `img_${customer.id}_${dateStr}_${ts}.jpg`;
        const iUrl = await uploadFile(BUCKETS.photos, imgPath, compressedUri);
        setImgUrl(iUrl);
      }

      setStep('ready');
    } catch (e) {
      console.warn('Asset error:', e.message);
      setStep('ready'); // proceed even on error
    }
  };

  const message = buildMessage({ customer, items, trackingNo, pdfUrl, shipDate });

  const copyAndMark = async () => {
    await Clipboard.setStringAsync(message);
    setSent(true);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // SMS — Open message app directly with number + text (Text only for maximum reliability)
  const sendSMS = async () => {
    const phone = (customer.tel || '').replace(/[^0-9]/g, '');
    
    // Always copy to clipboard
    await Clipboard.setStringAsync(message);
    setSent(true);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    try {
      // Use URL scheme for direct opening (Pre-fills number and text on most devices)
      const sep = Platform.OS === 'ios' ? '&' : '?';
      const url = `sms:${phone}${sep}body=${encodeURIComponent(message)}`;
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert('알림', '메시지가 클립보드에 복사되었습니다. SMS 앱을 열어 붙여넣기 하세요.');
    }
  };

  // KakaoTalk / Share sheet — copy text FIRST then open share
  const shareKakao = async () => {
    // Copy message to clipboard first so user can paste text in KakaoTalk
    await Clipboard.setStringAsync(message);
    setSent(true);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    try {
      if (photoUri) {
        const ok = await Sharing.isAvailableAsync();
        if (ok) {
          // Share sheet with photo (user selects KakaoTalk); text already copied to clipboard
          await Sharing.shareAsync(photoUri, { dialogTitle: '카카오톡으로 공유', mimeType: 'image/jpeg' });
        } else {
          await Share.share({ message, title: `[출고 알림] ${customer.name}` });
        }
      } else {
        await Share.share({ message, title: `[출고 알림] ${customer.name}` });
      }
    } catch (e) {
      if (e.message !== 'User did not share') {
        Alert.alert('오류', e.message);
      }
    }
  };

  const sharePhoto = async () => {
    if (!photoUri) { Alert.alert('사진 없음'); return; }
    const ok = await Sharing.isAvailableAsync();
    if (ok) await Sharing.shareAsync(photoUri, { dialogTitle: '송장 사진', mimeType: 'image/jpeg' });
  };

  const handleMarkShipped = async () => {
    try {
      // Save shipped_date with time (e.g. "2026-05-01 14:30")
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const shippedDateTime = `${shipDate} ${hh}:${mm}`;
      const update = { 
        status: 'shipped', 
        shipped_date: shippedDateTime, 
        tracking: trackingNo || '', 
        img_url: imgUrl || '',
        addr: customer.address || '',
        tel: customer.tel || ''
      };
      const oids = orderIds && orderIds.length > 0 ? orderIds : null;

      if (oids) {
        // Update only the specific orders the user selected
        await supabase.from('orders').update(update).in('id', oids);
      } else {
        // Fallback: update all pending orders for this customer
        await supabase.from('orders').update(update)
          .eq('customer_id', customer.id).eq('status', 'pending');
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('완료 ✅', '출고 처리가 완료되었습니다', [
        { text: '홈으로', onPress: () => navigation.navigate('Home') },
      ]);
    } catch (e) {
      Alert.alert('오류', e.message);
    }
  };

  const total = items.reduce((s, i) => s + (i.qty || 0) * (i.price || 0), 0);

  // ── Processing screen ─────────────────────────────────
  if (step === 'processing') {
    return (
      <View style={styles.processingRoot}>
        <View style={styles.processingCard}>
          <ActivityIndicator size="large" color={C.blue} />
          <Text style={styles.processingTitle}>준비 중...</Text>
          <Text style={styles.processingMsg}>{stepMsg}</Text>
          <View style={styles.processingSteps}>
            {['거래명세서 생성', 'PDF 업로드', photoUri ? '사진 업로드' : null]
              .filter(Boolean).map((s, i) => (
                <View key={i} style={styles.processingStep}>
                  <View style={styles.processingDot} />
                  <Text style={styles.processingStepText}>{s}</Text>
                </View>
              ))}
          </View>
        </View>
      </View>
    );
  }

  // ── Ready screen ──────────────────────────────────────
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>

      {/* Summary card */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLbl}>거래처</Text>
          <Text style={styles.summaryVal}>{customer.name}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLbl}>출고일</Text>
          <Text style={styles.summaryVal}>{shipDate}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLbl}>송장번호</Text>
          <Text style={[styles.summaryVal, { color: C.blue }]}>{trackingNo || '(없음)'}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLbl}>합계</Text>
          <Text style={[styles.summaryVal, { color: C.blue, fontSize: 16, fontWeight: '800' }]}>{fmt(total)}원</Text>
        </View>
        <View style={[styles.summaryRow, { borderBottomWidth: 0 }]}>
          <Text style={styles.summaryLbl}>명세서</Text>
          <View style={[styles.pdfChip, pdfUrl ? styles.pdfChipOk : styles.pdfChipWait]}>
            <Text style={[styles.pdfChipText, { color: pdfUrl ? '#1a7f2a' : '#b36a00' }]}>
              {pdfUrl ? '생성 완료 ✓' : '오류 (메시지만 발송)'}
            </Text>
          </View>
        </View>
      </View>

      {/* Photo preview */}
      {photoUri && (
        <View style={styles.photoCard}>
          <View style={styles.photoHeader}>
            <Text style={styles.sectionTitle}>📷 송장 사진</Text>
            <TouchableOpacity style={styles.sharePhotoBtn} onPress={sharePhoto}>
              <Text style={styles.sharePhotoBtnText}>📤 사진만 공유</Text>
            </TouchableOpacity>
          </View>
          <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />
        </View>
      )}

      {/* Message preview */}
      <View style={styles.msgCard}>
        <View style={styles.msgHeader}>
          <Text style={styles.sectionTitle}>📝 발송 메시지</Text>
          <TouchableOpacity style={styles.copyBtn} onPress={copyAndMark}>
            <Text style={styles.copyBtnText}>복사</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.msgBubble}>
          <Text style={styles.msgText}>{message}</Text>
        </View>
      </View>

      {/* Send buttons */}
      <View style={styles.sendCard}>
        <Text style={styles.sectionTitle}>📤 발송 방법 선택</Text>
        <SendBtn
          emoji="💬"
          label="SMS 문자 전송"
          sub="Samsung Messages 앱으로 열기"
          color={C.blue}
          onPress={sendSMS}
        />
        <SendBtn
          emoji="🟡"
          label="카카오톡 공유"
          sub={photoUri ? '사진 + 메시지 공유' : '메시지 공유'}
          color="#3a1d1d"
          onPress={shareKakao}
        />
      </View>

      {/* Mark shipped */}
      <View style={styles.doneSection}>
        {sent ? (
          <TouchableOpacity style={styles.shippedBtn} onPress={handleMarkShipped}>
            <Text style={styles.shippedBtnText}>✅  출고 완료 처리</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.pendingHintBox}>
            <Text style={styles.pendingHintText}>
              메시지를 발송하면{'\n'}출고 완료 버튼이 활성화됩니다
            </Text>
          </View>
        )}
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // ── Processing
  processingRoot: { flex: 1, backgroundColor: C.bg, justifyContent: 'center', padding: 32 },
  processingCard: {
    backgroundColor: C.canvas, borderRadius: 24,
    borderWidth: 1, borderColor: C.hairline,
    padding: 36, alignItems: 'center', gap: 14,
  },
  processingTitle: { fontSize: 18, fontWeight: '700', color: C.ink },
  processingMsg: { fontSize: 13, color: C.inkMuted, textAlign: 'center' },
  processingSteps: { gap: 8, alignSelf: 'stretch', marginTop: 4 },
  processingStep: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  processingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.blue },
  processingStepText: { fontSize: 13, color: C.inkMuted },

  // ── Main scroll
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 16, paddingBottom: 48, gap: 14 },

  sectionTitle: { fontSize: 13, fontWeight: '700', color: C.ink, letterSpacing: -0.1 },

  // ── Summary card
  summaryCard: {
    backgroundColor: C.canvas, borderRadius: 18,
    borderWidth: 1, borderColor: C.hairline, padding: 16, gap: 10,
  },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.hairline,
  },
  summaryLbl: { fontSize: 12, color: C.inkMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  summaryVal: { fontSize: 14, color: C.ink, fontWeight: '600' },
  pdfChip: { borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 },
  pdfChipOk: { backgroundColor: '#f0fdf4' },
  pdfChipWait: { backgroundColor: '#fff7ed' },
  pdfChipText: { fontSize: 12, fontWeight: '600' },

  // ── Photo card
  photoCard: {
    backgroundColor: C.canvas, borderRadius: 18,
    borderWidth: 1, borderColor: C.hairline, padding: 14, gap: 10,
  },
  photoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  photo: { width: '100%', height: 190, borderRadius: 12 },
  sharePhotoBtn: {
    backgroundColor: C.blueLight, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 5,
  },
  sharePhotoBtnText: { color: C.blue, fontSize: 12, fontWeight: '600' },

  // ── Message card
  msgCard: {
    backgroundColor: C.canvas, borderRadius: 18,
    borderWidth: 1, borderColor: C.hairline, padding: 14, gap: 10,
  },
  msgHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  copyBtn: { backgroundColor: C.blueLight, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 5 },
  copyBtnText: { color: C.blue, fontSize: 12, fontWeight: '600' },
  msgBubble: {
    backgroundColor: '#f0f4ff', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: 'rgba(0,102,204,0.1)',
  },
  msgText: {
    fontSize: 13, color: C.ink, lineHeight: 22,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },

  // ── Send card
  sendCard: {
    backgroundColor: C.canvas, borderRadius: 18,
    borderWidth: 1, borderColor: C.hairline, padding: 14, gap: 10,
  },
  sendBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.bg, borderRadius: 12,
    borderWidth: 1, borderColor: C.hairline, padding: 14,
  },
  sendBtnDisabled: { opacity: 0.45 },
  sendBtnIcon: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sendBtnEmoji: { fontSize: 22 },
  sendBtnLabel: { fontSize: 15, fontWeight: '700' },
  sendBtnSub: { fontSize: 11, color: C.inkMuted, marginTop: 2 },
  sendBtnArrow: { fontSize: 22, fontWeight: '300' },

  // ── Done
  doneSection: { alignItems: 'center' },
  shippedBtn: {
    backgroundColor: '#28cd41', borderRadius: 99,
    paddingVertical: 17, width: '100%', alignItems: 'center',
    shadowColor: '#28cd41', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  shippedBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  pendingHintBox: {
    backgroundColor: C.canvas, borderRadius: 12,
    borderWidth: 1, borderColor: C.hairline,
    paddingVertical: 14, paddingHorizontal: 20,
    width: '100%', alignItems: 'center',
  },
  pendingHintText: { color: C.inkMuted, fontSize: 12, textAlign: 'center', lineHeight: 20 },
});
