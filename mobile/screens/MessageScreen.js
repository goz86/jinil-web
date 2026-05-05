import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Image, Share, Linking, Alert, Platform, ActivityIndicator, FlatList, Modal,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import * as Print from 'expo-print';
import * as ImageManipulator from 'expo-image-manipulator';
import * as SMS from 'expo-sms';
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

let jinilSyncChannel = null;
let jinilSyncReady = false;

function getJinilSyncChannel() {
  if (jinilSyncChannel) return jinilSyncChannel;
  jinilSyncChannel = supabase.channel('jinil-sync', { config: { broadcast: { self: false } } });
  jinilSyncChannel.subscribe((status) => {
    jinilSyncReady = status === 'SUBSCRIBED';
  });
  return jinilSyncChannel;
}

function broadcastOrdersChanged(payload = {}) {
  const channel = getJinilSyncChannel();
  const message = {
    ...payload,
    source: 'mobile',
    at: new Date().toISOString(),
  };
  const send = () => {
    try {
      const result = channel.send({
        type: 'broadcast',
        event: 'orders_changed',
        payload: message,
      });
      if (result?.catch) result.catch(e => console.warn('Mobile broadcast failed:', e.message));
    } catch (e) {
      console.warn('Mobile broadcast failed:', e.message);
    }
  };
  send();
  if (!jinilSyncReady) {
    setTimeout(send, 350);
    setTimeout(send, 1200);
  }
}

// ── Message builder ───────────────────────────────────
// Clean message — image sent as actual file, only PDF link included
function buildMessage({ customer, items, trackingNo, shipDate, pdfUrl }) {
  const isKyunggi = (trackingNo && trackingNo.length === 16);
  const carrier = isKyunggi ? '경기택배' : '롯데택배';

  const itemLines = items
    .map((i, n) => `  ${n + 1}. ${i.name}${i.spec ? ` (${i.spec})` : ''} × ${i.qty}개`)
    .join('\n');

  return `[출고 알림] ${customer.name} 고객님
금일(${shipDate}) 출고되었습니다.

택배사: ${carrier}
📦 송장번호: ${trackingNo || '(확인 중)'}

품목:
${itemLines}

📑 거래명세서: ${pdfUrl || ''}
감사합니다.`;
}

// ── Invoice HTML ──────────────────────────────────────
// MAX_PDF_ITEMS: portrait A4 단면 기준 최대 30개
const MAX_PDF_ITEMS = 30;

function generateInvoiceHTML(customer, items, shipDate, supplier = {}) {
  // 전체 합계는 선택된 모든 품목 기준
  const total = items.reduce((s, i) => s + (i.qty || 0) * (i.price || 0), 0);
  const [yr, mo, dy] = shipDate.split('-');

  // PDF에 실제로 들어가는 품목 (최대 20개)
  const pdfItems  = items.slice(0, MAX_PDF_ITEMS);
  // 14개 이하면 14행, 그 이상이면 실제 품목 수만큼 행 생성
  const rowCount  = Math.max(1, pdfItems.length);
  // 15개 이상이면 행 높이를 줄여서 한 페이지에 맞춤
  const compact   = pdfItems.length > 14;
  const tdPadding = compact ? '1px 2px' : '3px 3px';
  const tdFont    = compact ? '7pt'     : '7.5pt';
  const thPadding = compact ? '2px 3px' : '4px 3px';

  const rows = Array.from({ length: rowCount }).map((_, i) => {
    const it = pdfItems[i];
    if (it) {
      return `<tr>
        <td>${mo}/${dy}</td>
        <td style="text-align:left;padding-left:6px">${it.name}${it.spec ? ` (${it.spec})` : ''}</td>
        <td></td><td>${it.qty}</td>
        <td style="text-align:right">${fmt(it.price)}</td>
        <td style="text-align:right">${fmt(it.qty * it.price)}</td>
        <td></td><td></td>
      </tr>`;
    }
    return `<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
  }).join('');

  const css = `
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    body { font-family: sans-serif; margin: 0; padding: 8mm; background:#fff; }
    .wrap { display:flex; width:100%; border:2px solid #1a6b3a; height:auto; }
    .copy { flex:1; padding:10px; border-right:2px solid #1a6b3a; position:relative; display:flex; flex-direction:column; }
    .copy:last-child { border-right:none; }
    .side { width:28px; flex-shrink:0; border-left:2px solid #1a6b3a; display:flex; flex-direction:column; align-items:center; justify-content:center; background:#f0fdf4; }
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
    table { width:calc(100% - 32px); border-collapse:collapse; font-size:${tdFont}; margin-top:4px; border:1px solid #1a6b3a; }
    th { background:#e8f5e8; color:#1a6b3a; border:1px solid #1a6b3a; padding:${thPadding}; font-size:${tdFont}; }
    td { border:1px solid #d4e8d4; padding:${tdPadding}; text-align:center; }
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
        <thead><tr><th>날짜</th><th>품목명</th><th>규격</th><th>수량</th><th>단가</th><th>공급가액</th><th>세액</th><th>비고</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="total">
        <div class="total-lbl">합 계</div>
        <div class="total-val">${fmt(total)}원</div>
      </div>
    </div>
    <div class="side">
      <div class="side-title">거래명세서</div>
      <div class="side-label">(${label})</div>
    </div>
  `;

  return `<html><head><meta charset="utf-8"><style>${css}</style></head>
    <body><div class="wrap">${copyHtml('공급받는자용')}</div></body></html>`;
}

// ── Send option button ────────────────────────────────
function SendBtn({ icon, emoji, label, sub, color = C.blue, onPress, disabled }) {
  return (
    <TouchableOpacity
      style={[styles.sendBtn, disabled && styles.sendBtnDisabled]}
      onPress={onPress}
      activeOpacity={0.75}
      disabled={disabled}
    >
      <View style={[styles.sendBtnIcon, { backgroundColor: color + '18' }]}>
        {icon ? icon : <Text style={styles.sendBtnEmoji}>{emoji}</Text>}
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
  const { customer, items, orderIds, fullyChecked, partialDetails, trackingNo, photos, photoUri, shipDate } = route.params;
  // Normalize: accept both `photos` array (new) and legacy `photoUri` (single)
  const allPhotos = photos || (photoUri ? [photoUri] : []);

  const [step,         setStep]         = useState('processing');
  const [pdfUrl,       setPdfUrl]       = useState(null);
  const [imgUrls,      setImgUrls]      = useState([]); // all uploaded photo URLs
  const [stepMsg,      setStepMsg]      = useState('PDF 생성 중...');
  const [sent,         setSent]         = useState(false);
  const [pdfTruncated, setPdfTruncated] = useState(false);
  const [skipConfirmVisible, setSkipConfirmVisible] = useState(false);

  useEffect(() => { processAssets(); }, []);

  const processAssets = async () => {
    try {
      if (items.length > MAX_PDF_ITEMS) setPdfTruncated(true);

      // 1. Fetch supplier info
      setStepMsg('공급자 정보 불러오는 중...');
      const supplier = await fetchSupplier();

      // 2. Generate + upload PDF
      setStepMsg('거래명세서 PDF 생성 중...');
      const html = generateInvoiceHTML(customer, items, shipDate, supplier);
      const { uri: pdfUri } = await Print.printToFileAsync({ html, base64: false });

      setStepMsg('PDF 업로드 중...');
      const dateStr = shipDate.replace(/-/g, '');
      const ts      = Math.floor(Date.now() / 1000) % 10000;
      const pdfPath = `jinil_${dateStr}_${ts}.pdf`;
      const rawUrl  = await uploadFile(BUCKETS.invoices, pdfPath, pdfUri);
      setPdfUrl(`https://docs.google.com/viewer?url=${encodeURIComponent(rawUrl)}`);

      // 3. Compress + upload ALL photos concurrently
      if (allPhotos.length > 0) {
        setStepMsg(`사진 ${allPhotos.length}장 업로드 중...`);
        const uploadTasks = allPhotos.map(async (uri, idx) => {
          const compressed = await compressImage(uri);
          const imgPath = `img_${customer.id}_${dateStr}_${ts}_${idx}.jpg`;
          return uploadFile(BUCKETS.photos, imgPath, compressed);
        });
        const urls = await Promise.all(uploadTasks);
        setImgUrls(urls);
      }

      setStep('ready');
    } catch (e) {
      console.warn('Asset error:', e.message);
      setStep('ready');
    }
  };

  const message = buildMessage({ customer, items, trackingNo, shipDate, pdfUrl });

  const copyAndMark = async () => {
    await Clipboard.setStringAsync(message);
    setSent(true);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // SMS — Opens message app with pre-filled number + text
  // Message already includes photo URLs and PDF link — no MMS needed
  const sendSMS = async () => {
    const phone = (customer.tel || '').replace(/[^0-9]/g, '');

    setStep('marking_shipped');
    setStepMsg('출고 정보 저장 중...');

    try {
      // 1. Save shipped status to DB
      await performMarkShipped();

      // 2. Open SMS app with pre-filled message (includes photo + PDF links)
      const sep = Platform.OS === 'ios' ? '&' : '?';
      const url = `sms:${phone}${sep}body=${encodeURIComponent(message)}`;
      await Linking.openURL(url);

      // 3. Go home
      navigation.navigate('Home');
    } catch (e) {
      Alert.alert('오류', e.message);
      setStep('ready');
    }
  };

  const askShareNextPhoto = (nextIndex, total) => new Promise(resolve => {
    navigation.navigate('Home');
    setTimeout(() => {
      Alert.alert(
        '다음 송장 사진',
        `${nextIndex + 1}/${total}번째 사진을 계속 보내시겠습니까?\n카카오톡에서 돌아온 뒤 계속을 누르세요.`,
        [
          { text: '완료', style: 'cancel', onPress: () => resolve(false) },
          { text: '계속 보내기 →', onPress: () => resolve(true) },
        ]
      );
    }, 250);
  });

  // 사진은 KakaoTalk에서 직접 보이도록 1장씩 수동 공유한다.
  const sharePhotoSequential = async (photos, idx = 0) => {
    const ok = await Sharing.isAvailableAsync();
    if (!ok) return false;

    for (let i = idx; i < photos.length; i += 1) {
      try {
        await Sharing.shareAsync(photos[i], {
          dialogTitle: `송장 사진 ${i + 1}/${photos.length}장`,
          mimeType: 'image/jpeg',
        });
      } catch (e) {
        if (e.message === 'User did not share') return false;
        throw e;
      }

      if (i + 1 < photos.length) {
        const shouldContinue = await askShareNextPhoto(i + 1, photos.length);
        if (!shouldContinue) return false;
      }
    }

    return true;
  };

  // Compress photo for sending — small enough for messaging, no quality needed
  // 480px wide, 55% quality → ~15-40KB, fast to send via Kakao/SMS
  const compressForShare = async (uri) => {
    try {
      const result = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 480 } }],
        { compress: 0.55, format: ImageManipulator.SaveFormat.JPEG }
      );
      return result.uri;
    } catch (e) {
      return uri;
    }
  };

  // KakaoTalk / Share — Expo Go compatible: copy message, then open native share sheet for the photo
  const shareKakao = async () => {
    setStep('marking_shipped');
    setStepMsg('출고 정보 저장 중...');

    try {
      // 1. Save shipped status to DB
      await performMarkShipped();

      // 2. Copy text first so user can paste it in KakaoTalk after choosing the photo.
      await Clipboard.setStringAsync(message);

      if (allPhotos.length > 0) {
        const shareUris = [];
        for (const uri of allPhotos) {
          shareUris.push(await compressForShare(uri));
        }
        const ok = await Sharing.isAvailableAsync();
        if (ok) {
          await sharePhotoSequential(shareUris, 0);
        } else {
          await Share.share({ message, title: `[출고 알림] ${customer.name}` });
        }
      } else {
        await Share.share({ message, title: `[출고 알림] ${customer.name}` });
      }

      navigation.navigate('Home');
    } catch (e) {
      if (e?.message !== 'User did not share') {
        Alert.alert('오류', e.message || '공유 실패');
      }
      setStep('ready');
    }
  };

  const sharePhoto = async () => {
    if (allPhotos.length === 0) { Alert.alert('사진 없음'); return; }
    await sharePhotoSequential(allPhotos, 0);
  };

  const missingColumnFrom = (error) => {
    const message = error?.message || '';
    const match = message.match(/Could not find the '([^']+)' column/);
    return match?.[1] || null;
  };

  const updateOrdersSafely = async (payload, applyFilter) => {
    let nextPayload = { ...payload };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const query = supabase.from('orders').update(nextPayload);
      const { error } = await applyFilter(query);
      if (!error) return;

      const missingColumn = missingColumnFrom(error);
      if (missingColumn && Object.prototype.hasOwnProperty.call(nextPayload, missingColumn)) {
        const { [missingColumn]: _removed, ...rest } = nextPayload;
        nextPayload = rest;
        console.warn(`orders.${missingColumn} column unavailable; retrying without it`);
        continue;
      }

      throw error;
    }

    throw new Error('orders update failed after removing unsupported columns');
  };

  const performMarkShipped = async () => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const shippedDateTime = `${shipDate} ${hh}:${mm}`;
    const changedOrderIds = [];

    if (fullyChecked && fullyChecked.length > 0) {
      for (const orderId of fullyChecked) {
        const { data: ord } = await supabase.from('orders').select('items').eq('id', orderId).single();
        const nextItems = (ord?.items || []).map(item => {
          if (item?.shipped === true || item?.shipped === 'true') return item;
          return {
            ...item,
            shipped: true,
            shipped_tracking: trackingNo || '',
            shipped_date: shippedDateTime,
            shipped_img_urls: imgUrls,
            shipped_pdf_url: pdfUrl || '',
          };
        });
        await updateOrdersSafely({
          items: nextItems,
          status: 'shipped',
          shipped_date: shippedDateTime,
          tracking: trackingNo || '',
          pdf_url: pdfUrl || '',
          addr: customer.addr || '',
          tel: customer.tel || '',
        }, q => q.eq('id', orderId));
        changedOrderIds.push(orderId);
      }
    }

    if (partialDetails && partialDetails.length > 0) {
      for (const pd of partialDetails) {
        const { data: ord } = await supabase.from('orders').select('items').eq('id', pd.orderId).single();
        const newItems = (ord?.items || []).map((item, idx) => {
          if (pd.itemIdxs.includes(idx)) {
            if (item?.shipped === true || item?.shipped === 'true') return item;
            return {
              ...item,
              shipped: true,
              shipped_tracking: trackingNo || '',
              shipped_date: shippedDateTime,
              shipped_img_urls: imgUrls,
              shipped_pdf_url: pdfUrl || '',
            };
          }
          return item;
        });
        const allNowShipped = newItems.every(it => it.shipped);
        await updateOrdersSafely({
          items: newItems,
          status: allNowShipped ? 'shipped' : 'pending',
          tracking: trackingNo || '',
          addr: customer.addr || '',
          tel: customer.tel || '',
          ...(allNowShipped ? { shipped_date: shippedDateTime, pdf_url: pdfUrl || '' } : {}),
        }, q => q.eq('id', pd.orderId));
        changedOrderIds.push(pd.orderId);
      }
    }
    broadcastOrdersChanged({
      action: 'mobile_ship',
      ids: [...new Set(changedOrderIds)],
      tracking: trackingNo || '',
    });
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleMarkShipped = async () => {
    setStep('marking_shipped');
    setStepMsg('출고 처리 중...');
    try {
      await performMarkShipped();
      Alert.alert('완료 ✅', '출고 처리가 완료되었습니다', [
        { text: '홈으로', onPress: () => navigation.navigate('Home') },
      ]);
    } catch (e) {
      Alert.alert('오류', e.message);
      setStep('ready');
    }
  };

  const goHomeWithoutSending = () => {
    setSkipConfirmVisible(true);
  };

  const confirmHomeWithoutSending = async () => {
    setSkipConfirmVisible(false);
    setStep('marking_shipped');
    setStepMsg('출고 정보 저장 중...');
    try {
      await performMarkShipped();
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    } catch (e) {
      Alert.alert('오류', e.message || '출고 정보 저장 실패');
      setStep('ready');
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
            {['거래명세서 생성', 'PDF 업로드', allPhotos.length > 0 ? '사진 업로드' : null]
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
    <>
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
        <View style={[styles.summaryRow, { borderBottomWidth: pdfTruncated ? 1 : 0 }]}>
          <Text style={styles.summaryLbl}>명세서</Text>
          <View style={[styles.pdfChip, pdfUrl ? styles.pdfChipOk : styles.pdfChipWait]}>
            <Text style={[styles.pdfChipText, { color: pdfUrl ? '#1a7f2a' : '#b36a00' }]}>
              {pdfUrl ? '생성 완료 ✓' : '오류 (메시지만 발송)'}
            </Text>
          </View>
        </View>
        {/* 품목 20개 초과 시 경고 */}
        {pdfTruncated && (
          <View style={[styles.summaryRow, { borderBottomWidth: 0, backgroundColor: '#fff7ed', borderRadius: 8, padding: 10, marginTop: 4 }]}>
            <Text style={{ fontSize: 12, color: '#b36a00', fontWeight: '600', lineHeight: 18 }}>
              ⚠️ 품목 {items.length}개 중 PDF에는 {MAX_PDF_ITEMS}개만 포함됩니다.{'\n'}
              나머지 {items.length - MAX_PDF_ITEMS}개는 메시지 문자에는 포함되어 있습니다.
            </Text>
          </View>
        )}
      </View>

      {/* Photo preview — multiple photos grid */}
      {allPhotos.length > 0 && (
        <View style={styles.photoCard}>
          <View style={styles.photoHeader}>
            <Text style={styles.sectionTitle}>📷 송장 사진 ({allPhotos.length}장)</Text>
            <TouchableOpacity style={styles.sharePhotoBtn} onPress={sharePhoto}>
              <Text style={styles.sharePhotoBtnText}>📤 공유</Text>
            </TouchableOpacity>
          </View>
          {allPhotos.length === 1 ? (
            <Image source={{ uri: allPhotos[0] }} style={styles.photo} resizeMode="cover" />
          ) : (
            <View style={styles.photoGrid}>
              {allPhotos.map((uri, idx) => (
                <View key={idx} style={styles.photoGridItem}>
                  <Image source={{ uri }} style={styles.photoGridImg} resizeMode="cover" />
                  <View style={styles.photoGridBadge}>
                    <Text style={styles.photoGridBadgeText}>{idx + 1}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
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
          icon={<Image source={{ uri: 'https://cdn-icons-png.flaticon.com/512/2111/2111466.png' }} style={{ width: 30, height: 30 }} resizeMode="contain" />}
          label="카카오톡 공유"
          sub={allPhotos.length > 0 ? '사진 + 메시지 공유' : '메시지 공유'}
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
          <TouchableOpacity style={styles.skipSendBtn} onPress={goHomeWithoutSending} activeOpacity={0.8}>
            <View style={styles.skipSendIcon}>
              <Text style={styles.skipSendIconText}>↩</Text>
            </View>
            <View style={styles.skipSendCopy}>
              <Text style={styles.skipSendBtnText}>명세서·메시지 없이 홈으로</Text>
              <Text style={styles.skipSendSubText}>출고 처리만 저장</Text>
            </View>
            <Text style={styles.skipSendArrow}>›</Text>
          </TouchableOpacity>
        )}
      </View>

    </ScrollView>
    <Modal
      visible={skipConfirmVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setSkipConfirmVisible(false)}
    >
      <View style={styles.confirmBackdrop}>
        <View style={styles.confirmCard}>
          <View style={styles.confirmIconWrap}>
            <Text style={styles.confirmIcon}>↩</Text>
          </View>
          <Text style={styles.confirmTitle}>출고 처리 후 홈으로</Text>
          <Text style={styles.confirmMessage}>
            선택한 품목은 출고 처리됩니다.{'\n'}
            명세서와 메시지는 발송되지 않습니다.
          </Text>
          <View style={styles.confirmSummary}>
            <View style={styles.confirmSummaryRow}>
              <Text style={styles.confirmSummaryLabel}>송장번호</Text>
              <Text style={styles.confirmSummaryValue}>{trackingNo || '(없음)'}</Text>
            </View>
            <View style={[styles.confirmSummaryRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.confirmSummaryLabel}>사진</Text>
              <Text style={[styles.confirmSummaryValue, { color: allPhotos.length ? C.green : C.inkMuted }]}>
                {allPhotos.length ? `${allPhotos.length}장 저장` : '없음'}
              </Text>
            </View>
          </View>
          <View style={styles.confirmActions}>
            <TouchableOpacity style={styles.confirmCancelBtn} onPress={() => setSkipConfirmVisible(false)}>
              <Text style={styles.confirmCancelText}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmOkBtn} onPress={confirmHomeWithoutSending}>
              <Text style={styles.confirmOkText}>출고 저장</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
    </>
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
  skipSendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff7ed',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#fed7aa',
    paddingVertical: 15,
    paddingHorizontal: 16,
    width: '100%',
    shadowColor: '#f97316',
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  skipSendIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffedd5',
  },
  skipSendIconText: { fontSize: 22, color: '#c2410c', fontWeight: '800' },
  skipSendCopy: { flex: 1, minWidth: 0 },
  skipSendBtnText: { color: '#9a3412', fontSize: 15, fontWeight: '800', textAlign: 'left' },
  skipSendSubText: { color: '#c2410c', fontSize: 11, fontWeight: '600', marginTop: 2 },
  skipSendArrow: { color: '#c2410c', fontSize: 24, fontWeight: '300' },

  // ── Custom confirmation modal
  confirmBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.56)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  confirmCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: C.canvas,
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  confirmIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fed7aa',
    marginBottom: 14,
  },
  confirmIcon: { fontSize: 26, color: '#c2410c', fontWeight: '800' },
  confirmTitle: { fontSize: 22, fontWeight: '800', color: C.ink, letterSpacing: -0.4 },
  confirmMessage: { fontSize: 15, color: C.inkMuted, lineHeight: 23, marginTop: 10 },
  confirmSummary: {
    backgroundColor: C.bg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.hairline,
    marginTop: 16,
    overflow: 'hidden',
  },
  confirmSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: C.hairline,
  },
  confirmSummaryLabel: { color: C.inkMuted, fontSize: 12, fontWeight: '700' },
  confirmSummaryValue: { color: C.ink, fontSize: 13, fontWeight: '800', flexShrink: 1, textAlign: 'right' },
  confirmActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  confirmCancelBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.hairline,
  },
  confirmCancelText: { color: C.inkMuted, fontSize: 14, fontWeight: '800' },
  confirmOkBtn: {
    flex: 1.35,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: '#f97316',
    shadowColor: '#f97316',
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  confirmOkText: { color: '#fff', fontSize: 14, fontWeight: '900' },

  // ── Multiple photos grid
  photoGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4,
  },
  photoGridItem: {
    position: 'relative',
    width: '48%', aspectRatio: 4 / 3, borderRadius: 10, overflow: 'hidden',
  },
  photoGridImg: { width: '100%', height: '100%' },
  photoGridBadge: {
    position: 'absolute', bottom: 6, right: 6,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  photoGridBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
