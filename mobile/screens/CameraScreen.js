import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image, ScrollView,
  Alert, Dimensions, Vibration, Modal, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { supabase, C } from '../lib/supabase';

const { width: SCREEN_W } = Dimensions.get('window');
const SCAN_BOX_W = SCREEN_W * 0.78;
const SCAN_BOX_H = 110;
const THUMB_SIZE = 64;

export default function CameraScreen({ route, navigation }) {
  const { customer, items, orderIds, fullyChecked, partialDetails, mode: initialMode } = route.params || {};

  const [permission,      requestPermission]     = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions();

  const [trackingNo,  setTrackingNo]  = useState('');
  const [scanned,     setScanned]     = useState(false);
  const [searching,   setSearching]   = useState(false);
  const [photos,      setPhotos]      = useState([]); // 📷 Multiple photos
  const [mode,        setMode]        = useState(
    initialMode === 'quickScan' ? 'quickScan' : 'scan'
  );
  const [shooting,    setShooting]    = useState(false); // prevent double-tap

  const [modalVisible, setModalVisible] = useState(false);
  const [manualInput,  setManualInput]  = useState('');

  const cameraRef = useRef(null);
  const isQuickScan = mode === 'quickScan';

  useEffect(() => {
    if (!permission?.granted)      requestPermission();
    if (!mediaPermission?.granted) requestMediaPermission();
  }, []);

  // ── Barcode scanned ───────────────────────────────────
  const onBarcodeScanned = async ({ data }) => {
    if (scanned || searching) return;
    let clean = data.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length > 16) clean = clean.slice(-16);
    if (clean.length < 5) return;

    setScanned(true);
    Vibration.vibrate(200);

    if (isQuickScan) {
      setSearching(true);
      try {
        const { data: ord, error } = await supabase
          .from('orders')
          .select('*, customers(*)')
          .or(`tracking.eq.${clean},tracking.eq.${data}`)
          .maybeSingle();
        if (error) throw error;
        if (ord) {
          Alert.alert(
            '📦 주문 발견',
            `${ord.customers.name} 고객님의 주문입니다.\n${ord.order_date}`,
            [
              { text: '주문 상세로 이동', onPress: () =>
                  navigation.navigate('Order', { customer: ord.customers, orders: [ord] }) },
              { text: '계속 스캔', style: 'cancel', onPress: () => {
                  setScanned(false); setSearching(false);
                }},
            ]
          );
        } else {
          Alert.alert('알림', `"${clean}" 에 해당하는 주문이 없습니다.`, [
            { text: '확인', onPress: () => { setScanned(false); setSearching(false); } }
          ]);
        }
      } catch (e) {
        Alert.alert('오류', e.message, [
          { text: '확인', onPress: () => { setScanned(false); setSearching(false); } }
        ]);
      } finally {
        setSearching(false);
      }
    } else {
      setTrackingNo(clean);
      setMode('photo');
    }
  };

  // ── Take photo — appends to photos array ──────────────
  const takePhoto = async () => {
    if (!cameraRef.current || shooting) return;
    setShooting(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (mediaPermission?.granted) await MediaLibrary.saveToLibraryAsync(photo.uri);
      setPhotos(prev => [...prev, photo.uri]);
      Vibration.vibrate([0, 40, 60, 40]); // double-pulse = success
    } catch (e) {
      Alert.alert('오류', '사진 촬영 실패: ' + e.message);
    } finally {
      setShooting(false);
    }
  };

  const removePhoto = (idx) => setPhotos(prev => prev.filter((_, i) => i !== idx));

  // ── Manual entry modal ────────────────────────────────
  const openManualModal = () => { setManualInput(''); setModalVisible(true); };
  const confirmManual   = () => {
    let v = manualInput.trim().toUpperCase();
    if (v.length > 16) v = v.slice(-16);
    if (v) { setTrackingNo(v); setScanned(true); setMode('photo'); }
    setModalVisible(false);
  };
  const skipToPhoto = () => { setModalVisible(false); setScanned(true); setMode('photo'); };

  // ── Navigate to message ───────────────────────────────
  const handleContinue = () => {
    const d = new Date();
    const shipDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    navigation.navigate('Message', {
      customer, items, orderIds, fullyChecked, partialDetails, trackingNo,
      photos: photos.length > 0 ? photos : null,
      photoUri: photos[0] || null,
      shipDate,
    });
  };

  // ── Reset ─────────────────────────────────────────────
  const reset = () => { setMode('scan'); setScanned(false); setPhotos([]); setTrackingNo(''); };

  // ── Permission screens ────────────────────────────────
  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.blue} />
        <Text style={styles.permText}>카메라 권한 확인 중...</Text>
      </View>
    );
  }
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permEmoji}>📷</Text>
        <Text style={styles.permTitle}>카메라 권한 필요</Text>
        <Text style={styles.permSub}>바코드 스캔과 송장 촬영을 위해{'\n'}카메라 접근이 필요합니다</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>권한 허용</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── DONE screen ───────────────────────────────────────
  if (mode === 'done') {
    return (
      <View style={styles.doneRoot}>
        <View style={styles.doneCard}>
          <View style={styles.doneIconWrap}>
            <Text style={styles.doneEmoji}>✅</Text>
          </View>
          <Text style={styles.doneTitle}>스캔 완료</Text>
          <Text style={styles.doneSub}>메시지를 작성하고 발송하세요</Text>

          <View style={styles.doneInfoBox}>
            <View style={styles.doneRow}>
              <Text style={styles.doneLabel}>거래처</Text>
              <Text style={styles.doneValue}>{customer?.name}</Text>
            </View>
            <View style={styles.doneRow}>
              <Text style={styles.doneLabel}>송장번호</Text>
              <Text style={[styles.doneValue, { color: C.blue }]}>{trackingNo || '(없음)'}</Text>
            </View>
            <View style={styles.doneRow}>
              <Text style={styles.doneLabel}>사진</Text>
              <Text style={[styles.doneValue, { color: photos.length > 0 ? '#1a7f2a' : C.inkMuted }]}>
                {photos.length > 0 ? `${photos.length}장 촬영 ✓` : '건너뜀'}
              </Text>
            </View>
            <View style={[styles.doneRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.doneLabel}>품목 수</Text>
              <Text style={styles.doneValue}>{items?.length ?? 0}개</Text>
            </View>
          </View>

          {/* Photo thumbnail preview on done screen */}
          {photos.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              style={styles.donePhotoStrip} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
              {photos.map((uri, idx) => (
                <Image key={idx} source={{ uri }} style={styles.doneThumb} />
              ))}
            </ScrollView>
          )}
        </View>

        <View style={styles.doneButtons}>
          <TouchableOpacity style={styles.retakeBtn} onPress={reset}>
            <Text style={styles.retakeBtnText}>↩ 다시 찍기</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.continueBtn} onPress={handleContinue}>
            <Text style={styles.continueBtnText}>메시지 작성 →</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Camera view ───────────────────────────────────────
  return (
    <View style={styles.cameraRoot}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['code128', 'code39', 'ean13', 'ean8', 'itf14', 'qr', 'datamatrix'] }}
        onBarcodeScanned={(mode === 'scan' || mode === 'quickScan') && !scanned && !searching
          ? onBarcodeScanned : undefined}
      />

      <View style={styles.overlayTop} />
      <View style={styles.overlayBottom} />

      <View style={styles.overlay}>

        {/* Top info */}
        <View style={styles.topInfo}>
          {isQuickScan && (
            <View style={styles.modeBadge}>
              <Text style={styles.modeBadgeText}>빠른 조회 모드</Text>
            </View>
          )}
          <Text style={styles.topTitle}>
            {mode === 'quickScan' ? '🔍 송장 바코드 스캔' :
             mode === 'scan'      ? '📦 바코드 스캔 → 📷 사진 촬영' :
                                    '📷 사진 촬영'}
          </Text>
          {customer && (
            <Text style={styles.topSub}>{customer.name} · {items?.length ?? 0}개 품목</Text>
          )}
          {trackingNo ? (
            <View style={styles.trackBadge}>
              <Text style={styles.trackText}>✓ {trackingNo}</Text>
            </View>
          ) : null}
          {searching && (
            <View style={styles.searchingBadge}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.searchingText}>검색 중...</Text>
            </View>
          )}
        </View>

        {/* Scan box (scan mode only) */}
        {(mode === 'scan' || mode === 'quickScan') && (
          <View style={styles.scanBoxWrap}>
            <View style={styles.scanBox}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
              <View style={styles.scanLine} />
            </View>
            <Text style={styles.scanHint}>바코드를 네모 안에 맞추거나 아래 ● 버튼으로 바로 촬영하세요</Text>
          </View>
        )}

        {/* Photo thumbnail strip (photo mode) */}
        {mode === 'photo' && photos.length > 0 && (
          <View style={styles.thumbStrip}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
              {photos.map((uri, idx) => (
                <View key={idx} style={styles.thumbWrap}>
                  <Image source={{ uri }} style={styles.thumbImg} />
                  {/* Delete button */}
                  <TouchableOpacity style={styles.thumbDel} onPress={() => removePhoto(idx)}>
                    <Text style={styles.thumbDelText}>✕</Text>
                  </TouchableOpacity>
                  {/* Index badge */}
                  <View style={styles.thumbBadge}>
                    <Text style={styles.thumbBadgeText}>{idx + 1}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
            <Text style={styles.thumbHint}>{photos.length}장 촬영됨 · 탭하면 삭제</Text>
          </View>
        )}

        {/* Bottom controls */}
        <View style={styles.bottomControls}>

          {/* ── SCAN mode ── */}
          {mode === 'scan' && (
            <>
              <TouchableOpacity style={styles.sideBtn} onPress={openManualModal}>
                <Text style={styles.sideBtnEmoji}>⌨️</Text>
                <Text style={styles.sideBtnText}>번호 입력</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.shutter}
                onPress={() => { setScanned(true); setMode('photo'); }}>
                <View style={styles.shutterInner} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.sideBtn}
                onPress={() => { setTrackingNo(''); setMode('done'); }}>
                <Text style={styles.sideBtnEmoji}>⏭</Text>
                <Text style={styles.sideBtnText}>사진 없이</Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── PHOTO mode ── */}
          {mode === 'photo' && (
            <>
              <TouchableOpacity style={styles.sideBtn}
                onPress={() => { setScanned(false); setMode('scan'); }}>
                <Text style={styles.sideBtnEmoji}>←</Text>
                <Text style={styles.sideBtnText}>다시 스캔</Text>
              </TouchableOpacity>

              {/* Shutter — with shooting lock & photo count badge */}
              <View>
                <TouchableOpacity
                  style={[styles.shutter, shooting && { opacity: 0.5 }]}
                  onPress={takePhoto}
                  disabled={shooting}>
                  <View style={styles.shutterInner} />
                </TouchableOpacity>
                {photos.length > 0 && (
                  <View style={styles.photoBadge}>
                    <Text style={styles.photoBadgeText}>{photos.length}</Text>
                  </View>
                )}
              </View>

              {/* 완료 — green when at least 1 photo taken */}
              <TouchableOpacity style={styles.sideBtn}
                onPress={() => setMode('done')}>
                <Text style={[styles.sideBtnEmoji, photos.length > 0 && { color: '#28cd41' }]}>
                  {photos.length > 0 ? '✓' : '⏭'}
                </Text>
                <Text style={[styles.sideBtnText, photos.length > 0 && { color: '#28cd41', fontWeight: '700' }]}>
                  {photos.length > 0 ? `완료(${photos.length})` : '사진 없이'}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── QUICK SCAN mode ── */}
          {mode === 'quickScan' && (
            <>
              <TouchableOpacity style={styles.sideBtn} onPress={openManualModal}>
                <Text style={styles.sideBtnEmoji}>⌨️</Text>
                <Text style={styles.sideBtnText}>직접 입력</Text>
              </TouchableOpacity>
              <View style={styles.shutterPlaceholder} />
              <TouchableOpacity style={styles.sideBtn} onPress={() => navigation.goBack()}>
                <Text style={styles.sideBtnEmoji}>✕</Text>
                <Text style={styles.sideBtnText}>닫기</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* Manual entry modal */}
      <Modal visible={modalVisible} transparent animationType="slide"
        onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>송장번호 직접 입력</Text>
            <Text style={styles.modalSub}>바코드 스캔이 어려울 때 사용하세요</Text>
            <TextInput
              style={styles.modalInput}
              value={manualInput}
              onChangeText={setManualInput}
              placeholder="송장번호 입력..."
              placeholderTextColor={C.inkLight}
              keyboardType="default"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={confirmManual}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalBtnGhost} onPress={skipToPhoto}>
                <Text style={styles.modalBtnGhostText}>번호 없이 계속</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalBtnPrimary} onPress={confirmManual}>
                <Text style={styles.modalBtnPrimaryText}>확인</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const CORNER_SIZE = 22;

const styles = StyleSheet.create({
  // ── Permission screens
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: '#111', padding: 32 },
  permEmoji: { fontSize: 52 },
  permTitle: { fontSize: 20, fontWeight: '700', color: '#fff', textAlign: 'center' },
  permSub:   { fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 22 },
  permText:  { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  permBtn:   { backgroundColor: C.blue, borderRadius: 99, paddingHorizontal: 28, paddingVertical: 14, marginTop: 8 },
  permBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // ── Camera root
  cameraRoot:    { flex: 1, backgroundColor: '#000' },
  overlayTop:    { position: 'absolute', top: 0, left: 0, right: 0, height: 200, backgroundColor: 'rgba(0,0,0,0.55)' },
  overlayBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 200, backgroundColor: 'rgba(0,0,0,0.55)' },
  overlay:       { flex: 1, justifyContent: 'space-between' },

  // ── Top info
  topInfo: { alignItems: 'center', paddingTop: 56, paddingHorizontal: 24, gap: 8 },
  modeBadge:     { backgroundColor: C.blue, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 4 },
  modeBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  topTitle: {
    color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  topSub:       { color: 'rgba(255,255,255,0.65)', fontSize: 13 },
  trackBadge:   { backgroundColor: 'rgba(40,205,65,0.25)', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(40,205,65,0.5)' },
  trackText:    { color: '#7fff8a', fontSize: 13, fontWeight: '600' },
  searchingBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  searchingText:  { color: '#fff', fontSize: 13 },

  // ── Scan box
  scanBoxWrap: { alignItems: 'center', gap: 16 },
  scanBox:     { width: SCAN_BOX_W, height: SCAN_BOX_H, position: 'relative' },
  corner:      { position: 'absolute', width: CORNER_SIZE, height: CORNER_SIZE, borderColor: '#fff', borderWidth: 3 },
  cornerTL: { top: 0, left: 0,    borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 4 },
  cornerTR: { top: 0, right: 0,   borderLeftWidth: 0,  borderBottomWidth: 0, borderTopRightRadius: 4 },
  cornerBL: { bottom: 0, left: 0,  borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0,  borderTopWidth: 0, borderBottomRightRadius: 4 },
  scanLine: { position: 'absolute', top: '50%', left: 8, right: 8, height: 2, backgroundColor: C.blue, borderRadius: 2, opacity: 0.85 },
  scanHint: { color: 'rgba(255,255,255,0.6)', fontSize: 12, letterSpacing: 0.2, textAlign: 'center', paddingHorizontal: 20 },

  // ── Photo thumbnail strip (photo mode)
  thumbStrip: { alignItems: 'center', gap: 6 },
  thumbHint:  { color: 'rgba(255,255,255,0.5)', fontSize: 11 },
  thumbWrap:  { position: 'relative' },
  thumbImg:   { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 10, borderWidth: 2, borderColor: '#fff' },
  thumbDel:   {
    position: 'absolute', top: -6, right: -6,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(255,59,48,0.9)',
    alignItems: 'center', justifyContent: 'center',
  },
  thumbDelText:  { color: '#fff', fontSize: 10, fontWeight: '800' },
  thumbBadge:    { position: 'absolute', bottom: -4, left: -4, backgroundColor: C.blue, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  thumbBadgeText:{ color: '#fff', fontSize: 9, fontWeight: '700' },

  // ── Bottom controls
  bottomControls: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 28, paddingBottom: 52, paddingTop: 16,
  },
  sideBtn:      { alignItems: 'center', justifyContent: 'center', width: 80, gap: 4 },
  sideBtnEmoji: { fontSize: 20 },
  sideBtnText:  { color: 'rgba(255,255,255,0.7)', fontSize: 11, textAlign: 'center', fontWeight: '500' },
  shutter:      {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3.5, borderColor: '#fff',
  },
  shutterInner:      { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  shutterPlaceholder:{ width: 76, height: 76 },
  // Badge on shutter showing photo count
  photoBadge:    {
    position: 'absolute', top: -4, right: -4,
    backgroundColor: '#28cd41', borderRadius: 12,
    minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  photoBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },

  // ── Done screen
  doneRoot: { flex: 1, backgroundColor: C.bg, justifyContent: 'center', padding: 24 },
  doneCard: {
    backgroundColor: C.canvas, borderRadius: 24,
    borderWidth: 1, borderColor: C.hairline,
    padding: 28, alignItems: 'center', marginBottom: 20,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  doneIconWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#f0fdf4', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  doneEmoji:   { fontSize: 38 },
  doneTitle:   { fontSize: 22, fontWeight: '700', color: C.ink, letterSpacing: -0.3 },
  doneSub:     { fontSize: 13, color: C.inkMuted, marginTop: 4, marginBottom: 20 },
  doneInfoBox: { width: '100%', borderRadius: 12, borderWidth: 1, borderColor: C.hairline, overflow: 'hidden' },
  doneRow:     { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.hairline },
  doneLabel:   { fontSize: 13, color: C.inkMuted, fontWeight: '500' },
  doneValue:   { fontSize: 13, fontWeight: '700', color: C.ink },
  donePhotoStrip: { marginTop: 14, width: '100%' },
  doneThumb:   { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 10, borderWidth: 1, borderColor: C.hairline },

  doneButtons:     { flexDirection: 'row', gap: 10 },
  retakeBtn:       { flex: 1, paddingVertical: 15, borderRadius: 99, borderWidth: 1.5, borderColor: C.border, alignItems: 'center' },
  retakeBtnText:   { color: C.ink, fontWeight: '600', fontSize: 14 },
  continueBtn:     { flex: 2, paddingVertical: 15, borderRadius: 99, backgroundColor: C.blue, alignItems: 'center' },
  continueBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // ── Manual entry modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalBox: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, gap: 14 },
  modalHandle:    { width: 36, height: 4, backgroundColor: '#ddd', borderRadius: 2, alignSelf: 'center', marginBottom: 8 },
  modalTitle:     { fontSize: 18, fontWeight: '700', color: C.ink, textAlign: 'center' },
  modalSub:       { fontSize: 13, color: C.inkMuted, textAlign: 'center' },
  modalInput:     { borderWidth: 1.5, borderColor: C.blue, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: C.ink, backgroundColor: '#f5f8ff', letterSpacing: 1 },
  modalButtons:   { flexDirection: 'row', gap: 10, marginTop: 4 },
  modalBtnGhost:  { flex: 1, paddingVertical: 14, borderRadius: 99, borderWidth: 1.5, borderColor: C.border, alignItems: 'center' },
  modalBtnGhostText:   { color: C.inkMuted, fontWeight: '600', fontSize: 14 },
  modalBtnPrimary:     { flex: 1.5, paddingVertical: 14, borderRadius: 99, backgroundColor: C.blue, alignItems: 'center' },
  modalBtnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
