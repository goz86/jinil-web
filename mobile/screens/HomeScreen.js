import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, RefreshControl, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase, fmt, orderTotal, C } from '../lib/supabase';
import { useAuth } from '../lib/auth';

const AVATAR_COLORS = [
  '#0066cc','#28cd41','#ff9500','#0d9488',
  '#a78bfa','#ff3b30','#e879f9','#38bdf8',
];
const avatarColor = (name = '?') =>
  AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];

// ── Customer card ─────────────────────────────────────
function CustomerCard({ customer, orders, onPress, isAdmin }) {
  const color   = customer.color || avatarColor(customer.name);
  const pending = orders.filter(o => o.status === 'pending').length;
  const total   = orders.reduce((s, o) => s + orderTotal(o), 0);
  const latest  = orders[0]?.order_date;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.72}>
      {/* Avatar */}
      <View style={[styles.avatar, { backgroundColor: color + '20' }]}>
        <Text style={[styles.avatarText, { color }]}>{customer.name[0]}</Text>
      </View>

      {/* Body */}
      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={1}>{customer.name}</Text>
        <Text style={styles.cardTel}>{customer.tel}</Text>
        {latest && <Text style={styles.cardDate}>최근 {latest}</Text>}
      </View>

      {/* Right */}
      <View style={styles.cardRight}>
        <Text style={styles.cardTotal}>{isAdmin ? fmt(total)+'원' : '••••원'}</Text>
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
  const [customers,  setCustomers]  = useState([]);
  const [orders,     setOrders]     = useState([]);
  const [query,      setQuery]      = useState('');
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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
    const ordersA = orders.filter(o => o.customer_id == a.id).length;
    const ordersB = orders.filter(o => o.customer_id == b.id).length;
    
    // Rule 1: 0 orders go to bottom
    if (ordersA > 0 && ordersB === 0) return -1;
    if (ordersA === 0 && ordersB > 0) return 1;
    
    // Rule 2: Sort by latest order date (newest first)
    const dateA = getLatestDate(a.id);
    const dateB = getLatestDate(b.id);
    if (dateA !== dateB) return dateB.localeCompare(dateA);
    
    // Rule 3: Alphabetical if same date
    return a.name.localeCompare(b.name);
  });

  const filtered = sortedCustomers.filter(c =>
    c.name.toLowerCase().includes(query.toLowerCase()) ||
    (c.tel || '').includes(query)
  );

  const pendingCount  = orders.filter(o => o.status === 'pending').length;
  const shippedToday  = orders.filter(o => o.status === 'shipped' &&
    o.shipped_date === new Date().toISOString().slice(0,10)).length;

  const { width } = useWindowDimensions();
  const numColumns = width >= 600 ? 2 : 1;

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
          <StatPill value={pendingCount}     label="출고대기" color='#b36a00' />
          <View style={styles.statDivider} />
          <StatPill value={orders.length}    label="전체주문" color={C.ink} />
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
                onPress={() => navigation.navigate('Order', {
                  customer: item,
                  orders: custOrders,
                })}
                isAdmin={isAdmin}
              />
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.bg },
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
  statPill:   { flex: 1, alignItems: 'center', gap: 2 },
  statNum:    { fontSize: 22, fontWeight: '700', letterSpacing: -0.5 },
  statLabel:  { fontSize: 11, color: C.inkMuted, fontWeight: '600' },
  statDivider:{ width: 1, backgroundColor: C.hairline },

  // ── Search row
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f1f3f5',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    gap: 8,
  },
  searchIcon:  { fontSize: 13, opacity: 0.5 },
  searchInput: { flex: 1, fontSize: 14, color: C.ink },
  clearBtn:    { padding: 2 },
  clearBtnText:{ color: C.inkLight, fontSize: 14, fontWeight: '700' },

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
  cardBody:  { flex: 1, gap: 2 },
  cardName:  { fontSize: 15, fontWeight: '700', color: C.ink, letterSpacing: -0.2 },
  cardTel:   { fontSize: 12, color: C.blue },
  cardDate:  { fontSize: 11, color: C.inkLight, marginTop: 1 },
  cardRight: { alignItems: 'flex-end', gap: 3 },
  cardTotal: { fontSize: 14, fontWeight: '700', color: C.ink },
  cardOrderCount: { fontSize: 11, color: C.inkMuted },
  pendingBadge: {
    backgroundColor: '#fff7ed', borderRadius: 99,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: '#fed7aa',
  },
  pendingBadgeText: { color: '#b36a00', fontSize: 10, fontWeight: '700' },

  // ── Empty
  empty:      { alignItems: 'center', paddingTop: 72, gap: 8 },
  emptyEmoji: { fontSize: 40 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: C.ink },
  emptySub:   { fontSize: 13, color: C.inkMuted, textAlign: 'center' },
});
