import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, RefreshControl, ActivityIndicator, useWindowDimensions,
  Modal, ScrollView as RNScrollView, KeyboardAvoidingView, Platform
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase, fmt, orderTotal, C } from '../lib/supabase';
import { useAuth } from '../lib/auth';

const AVATAR_COLORS = [
  '#0066cc', '#28cd41', '#ff9500', '#0d9488',
  '#a78bfa', '#ff3b30', '#e879f9', '#38bdf8',
];
const avatarColor = (name = '?') =>
  AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];

// ── Customer card ─────────────────────────────────────
function CustomerCard({ customer, orders, onPress, isAdmin }) {
  const color = customer.color || avatarColor(customer.name);
  const pending = orders.filter(o => o.status === 'pending').length;
  const total = orders.reduce((s, o) => s + orderTotal(o), 0);
  const latest = orders[0]?.order_date;

  // Count unique addresses
  const addrMap = new Map();
  if (customer.addr || customer.tel) addrMap.set(`${customer.addr}|${customer.tel}`, 1);
  orders.forEach(o => {
    if (o.addr || o.tel) addrMap.set(`${o.addr}|${o.tel}`, 1);
  });
  const addrCount = addrMap.size;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.72}>
      {/* Avatar */}
      <View style={[styles.avatar, { backgroundColor: color + '20' }]}>
        <Text style={[styles.avatarText, { color }]}>{customer.name[0]}</Text>
      </View>

      {/* Body */}
      <View style={styles.cardBody}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={styles.cardName} numberOfLines={1}>{customer.name}</Text>
          {addrCount > 1 && (
            <View style={styles.addrCountBadge}>
              <Text style={styles.addrCountText}>{addrCount}곳</Text>
            </View>
          )}
        </View>
        <Text style={styles.cardTel}>{customer.tel}</Text>
        {customer.addr && (
          <Text style={styles.cardAddress} numberOfLines={1}>{customer.addr}</Text>
        )}
        {latest && <Text style={styles.cardDate}>최근 {latest}</Text>}
      </View>

      {/* Right */}
      <View style={styles.cardRight}>
        <Text style={styles.cardTotal}>{isAdmin ? fmt(total) + '원' : '••••원'}</Text>
        <Text style={styles.cardOrderCount}>{orders.length}건</Text>
        {pending > 0 && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>대기 {pending}</Text>
          </View>
        )}
      </View>

      {/* Left accent bar */}
      {pending > 0 && <View style={[styles.accentBar, { backgroundColor: color }]} />}
    </TouchableOpacity>
  );
}

// ── Address Select Modal ────────────────────────────────
function AddressSelectModal({ visible, customer, orders, onSelect, onClose }) {
  const [showNewInput, setShowNewInput] = useState(false);
  const [newAddr, setNewAddr]           = useState('');
  const [newTel,  setNewTel]            = useState('');
  const newAddrRef = useRef(null);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!visible) { setShowNewInput(false); setNewAddr(''); setNewTel(''); }
  }, [visible]);

  if (!customer) return null;

  // Collect unique addresses: customer profile first, then order history (newest→oldest)
  const addrMap = new Map();
  if (customer.addr || customer.tel) {
    const key = `${customer.addr || ''}|${customer.tel || ''}`;
    addrMap.set(key, { addr: customer.addr || '', tel: customer.tel || '', label: '기본 주소', isDefault: true });
  }
  // orders already sorted newest-first from loadData
  [...orders]
    .sort((a, b) => (b.order_date || '').localeCompare(a.order_date || ''))
    .forEach(o => {
      if (o.addr || o.tel) {
        const key = `${o.addr || ''}|${o.tel || ''}`;
        if (!addrMap.has(key)) {
          addrMap.set(key, { addr: o.addr || '', tel: o.tel || '', label: `이전 배송지 · ${o.order_date || ''}`, isDefault: false });
        }
      }
    });
  const uniqueAddrs = Array.from(addrMap.values());

  const handleNewConfirm = () => {
    const addr = newAddr.trim();
    if (!addr) return;
    onSelect(addr, newTel.trim());
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{customer.name}</Text>
              <Text style={styles.modalSub}>배송지/연락처를 선택해 주세요.</Text>
            </View>

            <RNScrollView style={styles.modalScroll} bounces={false} keyboardShouldPersistTaps="handled">
              {/* Existing address list */}
              {uniqueAddrs.map((item, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.addrItem}
                  onPress={() => onSelect(item.addr, item.tel)}
                >
                  <View style={[styles.addrLabelWrap, item.isDefault && { backgroundColor: C.blueLight }]}>
                    <Text style={[styles.addrLabel, item.isDefault && { color: C.blue }]}>{item.label}</Text>
                  </View>
                  <Text style={styles.addrText}>{item.addr || '(주소 없음)'}</Text>
                  <Text style={styles.addrTel}>{item.tel || '(연락처 없음)'}</Text>
                </TouchableOpacity>
              ))}

              {/* New address input section */}
              {!showNewInput ? (
                <TouchableOpacity
                  style={[styles.addrItem, { borderBottomWidth: 0 }]}
                  onPress={() => {
                    setShowNewInput(true);
                    setTimeout(() => newAddrRef.current?.focus(), 100);
                  }}
                >
                  <Text style={[styles.addrText, { color: C.blue, fontWeight: '700' }]}>+ 새 주소 직접 입력</Text>
                </TouchableOpacity>
              ) : (
                <View style={[styles.addrItem, { borderBottomWidth: 0, gap: 8 }]}>
                  <Text style={[styles.addrLabel, { color: C.blue, marginBottom: 4 }]}>새 주소 입력</Text>
                  <TextInput
                    ref={newAddrRef}
                    style={styles.newAddrInput}
                    placeholder="배송 주소를 입력하세요"
                    placeholderTextColor={C.inkLight}
                    value={newAddr}
                    onChangeText={setNewAddr}
                    returnKeyType="next"
                  />
                  <TextInput
                    style={styles.newAddrInput}
                    placeholder="연락처 (선택)"
                    placeholderTextColor={C.inkLight}
                    value={newTel}
                    onChangeText={setNewTel}
                    keyboardType="phone-pad"
                    returnKeyType="done"
                    onSubmitEditing={handleNewConfirm}
                  />
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                    <TouchableOpacity
                      style={[styles.newAddrBtn, { backgroundColor: '#f1f3f5', flex: 1 }]}
                      onPress={() => setShowNewInput(false)}
                    >
                      <Text style={[styles.newAddrBtnText, { color: C.inkMuted }]}>취소</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.newAddrBtn, { backgroundColor: C.blue, flex: 2 }]}
                      onPress={handleNewConfirm}
                    >
                      <Text style={[styles.newAddrBtnText, { color: '#fff' }]}>이 주소로 선택</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </RNScrollView>

            <TouchableOpacity style={styles.modalCloseBtn} onPress={onClose}>
              <Text style={styles.modalCloseText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Stats pill ────────────────────────────────────────
function StatPill({ value, label, color }) {
  return (
    <View style={styles.statPill}>
      <Text style={[styles.statNum, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ── Main ──────────────────────────────────────────────
export default function HomeScreen({ navigation }) {
  const { isAdmin } = useAuth();
  const [customers, setCustomers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selCust, setSelCust] = useState(null); // For address modal

  const loadData = useCallback(async () => {
    try {
      const [{ data: custs, error: e1 }, { data: ords, error: e2 }] = await Promise.all([
        supabase.from('customers').select('*').order('name'),
        supabase.from('orders').select('*').order('order_date', { ascending: false }),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      setCustomers(custs || []);
      setOrders(ords || []);
    } catch (e) {
      console.warn('Load error:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  // ── Real-time Sync ────────────────────────────────────
  useEffect(() => {
    console.log('🔌 Subscribing to global changes (Home)...');

    const channel = supabase.channel('home-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        console.log('🔔 Order change detected, refreshing Home...');
        loadData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, () => {
        console.log('🔔 Customer change detected, refreshing Home...');
        loadData();
      })
      .subscribe();

    return () => {
      console.log('📴 Unsubscribing Home sync');
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  const getLatestDate = (custId) => {
    const custOrders = orders.filter(o => o.customer_id == custId);
    if (custOrders.length === 0) return '0000-00-00';
    return custOrders[0].order_date; // Orders are already sorted by date desc
  };

  const sortedCustomers = [...customers].sort((a, b) => {
    const custOrdersA = orders.filter(o => o.customer_id == a.id);
    const custOrdersB = orders.filter(o => o.customer_id == b.id);

    const pendingA = custOrdersA.filter(o => o.status === 'pending').length;
    const pendingB = custOrdersB.filter(o => o.status === 'pending').length;

    // Rule 1: Priority for higher pending count
    if (pendingA !== pendingB) return pendingB - pendingA;

    // Rule 2: 0 orders go to bottom
    if (custOrdersA.length > 0 && custOrdersB.length === 0) return -1;
    if (custOrdersA.length === 0 && custOrdersB.length > 0) return 1;

    // Rule 3: Sort by latest order date (newest first)
    const dateA = getLatestDate(a.id);
    const dateB = getLatestDate(b.id);
    if (dateA !== dateB) return dateB.localeCompare(dateA);

    // Rule 4: Alphabetical if same date
    return a.name.localeCompare(b.name);
  });

  const filtered = sortedCustomers.filter(c =>
    c.name.toLowerCase().includes(query.toLowerCase()) ||
    (c.tel || '').includes(query)
  );

  const pendingCount = orders.filter(o => o.status === 'pending').length;
  const shippedToday = orders.filter(o => o.status === 'shipped' &&
    o.shipped_date === new Date().toISOString().slice(0, 10)).length;

  const { width } = useWindowDimensions();
  const numColumns = width >= 600 ? 2 : 1;

  const handleCustPress = (cust) => {
    const custOrders = orders.filter(o => o.customer_id == cust.id);
    setSelCust({ cust, orders: custOrders });
  };

  const handleAddrSelect = (addr, tel) => {
    const { cust, orders: custOrders } = selCust;
    setSelCust(null);
    navigation.navigate('Order', {
      customer: { ...cust, addr: addr, tel: tel }, // Pass selected address
      orders: custOrders,
    });
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={C.blue} />
        <Text style={styles.loadingText}>데이터 불러오는 중...</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>

      {/* ── Stats header ── */}
      <View style={styles.header}>
        <View style={styles.statsRow}>
          <StatPill value={customers.length} label="거래처" color={C.blue} />
          <View style={styles.statDivider} />
          <StatPill value={pendingCount} label="출고대기" color='#b36a00' />
          <View style={styles.statDivider} />
          <StatPill value={orders.length} label="전체주문" color={C.ink} />
        </View>

        {/* Search + quickScan */}
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="거래처 이름 · 전화번호 검색"
              placeholderTextColor={C.inkLight}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')} style={styles.clearBtn}>
                <Text style={styles.clearBtnText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            style={styles.quickScanBtn}
            onPress={() => navigation.navigate('Camera', { mode: 'quickScan' })}
            activeOpacity={0.8}>
            <Text style={styles.quickScanEmoji}>📷</Text>
            <Text style={styles.quickScanLabel}>송장{'\n'}검색</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Customer list ── */}
      <FlatList
        data={filtered}
        key={numColumns}
        numColumns={numColumns}
        columnWrapperStyle={numColumns > 1 ? { gap: 10 } : null}
        keyExtractor={item => String(item.id)}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); loadData(); }}
            tintColor={C.blue}
            colors={[C.blue]}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>{query ? '🔍' : '👥'}</Text>
            <Text style={styles.emptyTitle}>
              {query ? '검색 결과가 없습니다' : '거래처가 없습니다'}
            </Text>
            {!query && <Text style={styles.emptySub}>Supabase에 거래처 데이터를 추가하세요</Text>}
          </View>
        }
        renderItem={({ item }) => {
          const custOrders = orders.filter(o => o.customer_id == item.id);
          return (
            <View style={{ flex: 1 / numColumns }}>
              <CustomerCard
                customer={item}
                orders={custOrders}
                onPress={() => handleCustPress(item)}
                isAdmin={isAdmin}
              />
            </View>
          );
        }}
      />

      <AddressSelectModal
        visible={!!selCust}
        customer={selCust?.cust}
        orders={orders.filter(o => o.customer_id == selCust?.cust?.id)}
        onSelect={handleAddrSelect}
        onClose={() => setSelCust(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: C.bg },
  loadingText: { color: C.inkMuted, fontSize: 14, marginTop: 8 },

  // ── Header
  header: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: C.hairline,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 12,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: '#f8f9fa',
    borderRadius: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: C.hairline,
  },
  statPill: { flex: 1, alignItems: 'center', gap: 2 },
  statNum: { fontSize: 22, fontWeight: '700', letterSpacing: -0.5 },
  statLabel: { fontSize: 11, color: C.inkMuted, fontWeight: '600' },
  statDivider: { width: 1, backgroundColor: C.hairline },

  // ── Search row
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f1f3f5',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    gap: 8,
  },
  searchIcon: { fontSize: 13, opacity: 0.5 },
  searchInput: { flex: 1, fontSize: 14, color: C.ink },
  clearBtn: { padding: 2 },
  clearBtnText: { color: C.inkLight, fontSize: 14, fontWeight: '700' },

  quickScanBtn: {
    backgroundColor: C.blue, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  quickScanEmoji: { fontSize: 18 },
  quickScanLabel: { color: '#fff', fontSize: 9, fontWeight: '700', textAlign: 'center', marginTop: 1, lineHeight: 13 },

  // ── List
  list: { padding: 14, paddingBottom: 32 },

  // ── Card
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.canvas, borderRadius: 16,
    borderWidth: 1, borderColor: C.hairline,
    padding: 14, gap: 12,
    overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  accentBar: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '700' },
  cardBody: { flex: 1, gap: 2 },
  cardName: { fontSize: 15, fontWeight: '700', color: C.ink, letterSpacing: -0.2 },
  cardTel: { fontSize: 12, color: C.blue },
  cardAddress: { fontSize: 11, color: C.inkMuted, marginTop: 1 },
  cardDate: { fontSize: 11, color: C.inkLight, marginTop: 1 },
  cardRight: { alignItems: 'flex-end', gap: 3 },
  cardTotal: { fontSize: 14, fontWeight: '700', color: C.ink },
  cardOrderCount: { fontSize: 11, color: C.inkMuted },
  pendingBadge: {
    backgroundColor: '#fff7ed', borderRadius: 99,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: '#fed7aa',
  },
  pendingBadgeText: { color: '#b36a00', fontSize: 10, fontWeight: '700' },

  addrCountBadge: {
    backgroundColor: '#f1f3f5', borderRadius: 4,
    paddingHorizontal: 4, paddingVertical: 1,
  },
  addrCountText: { color: C.inkMuted, fontSize: 10, fontWeight: '700' },

  // ── Empty
  emptySub: { fontSize: 13, color: C.inkMuted, textAlign: 'center' },

  // ── Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', padding: 24,
  },
  modalContent: {
    backgroundColor: '#fff', borderRadius: 24,
    maxHeight: '80%', overflow: 'hidden',
  },
  modalHeader: {
    padding: 20, borderBottomWidth: 1, borderBottomColor: C.hairline,
    alignItems: 'center',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.ink },
  modalSub: { fontSize: 13, color: C.inkMuted, marginTop: 4 },
  modalScroll: { padding: 10 },
  addrItem: {
    padding: 16, borderBottomWidth: 1, borderBottomColor: C.hairline,
    gap: 4,
  },
  addrLabelWrap: {
    alignSelf: 'flex-start', backgroundColor: '#f1f3f5',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  addrLabel: { fontSize: 10, fontWeight: '700', color: C.inkMuted },
  addrText: { fontSize: 14, color: C.ink, fontWeight: '600' },
  addrTel: { fontSize: 13, color: C.blue },
  modalCloseBtn: {
    padding: 16, alignItems: 'center', borderTopWidth: 1, borderTopColor: C.hairline,
  },
  modalCloseText: { fontSize: 16, fontWeight: '600', color: C.inkLight },

  // ── New address input
  newAddrInput: {
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: C.ink, backgroundColor: '#fafafa',
  },
  newAddrBtn: {
    paddingVertical: 11, borderRadius: 10, alignItems: 'center',
  },
  newAddrBtnText: { fontSize: 14, fontWeight: '700' },
});
