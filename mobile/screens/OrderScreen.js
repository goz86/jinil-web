import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert,
} from 'react-native';
import { fmt, orderTotal, C, supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

const STATUS = {
  new:     { label: '신규',     color: C.blue,    bg: C.blueLight  },
  pending: { label: '출고대기', color: '#b36a00', bg: '#fff7ed'    },
  shipped: { label: '출고완료', color: '#1a7f2a', bg: '#f0fdf4'    },
};

// ── Checkbox item row ─────────────────────────────────
function ItemRow({ item, checked, onToggle, isShipped, isAdmin }) {
  const isDone = checked || isShipped;
  return (
    <TouchableOpacity
      style={[styles.itemRow, checked && styles.itemRowChecked]}
      onPress={onToggle}
      activeOpacity={0.7}
      disabled={isShipped}
    >
      <View style={[styles.checkbox, isDone && styles.checkboxOn, isShipped && { opacity: 0.5 }]}>
        {isDone && <Text style={styles.checkmark}>✓</Text>}
      </View>

      <View style={styles.itemBody}>
        <Text style={[styles.itemName, isDone && styles.itemNameDone]} numberOfLines={1}>
          {item.name}
        </Text>
        {item.spec ? <Text style={styles.itemSpec}>{item.spec}</Text> : null}
      </View>

      <View style={styles.itemRight}>
        <Text style={[styles.itemSubtotal, isDone && { color: C.blue }]}>
          {isAdmin ? fmt(item.qty * item.price)+'원' : '••••원'}
        </Text>
        <Text style={styles.itemQtyPrice}>× {item.qty}개{isAdmin ? ` · ${fmt(item.price)}원` : ''}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Order group ───────────────────────────────────────
function OrderSection({ order, checkedMap, onToggle, isAdmin }) {
  const st    = STATUS[order.status] || STATUS.new;
  const total = orderTotal(order);
  const isShipped = order.status === 'shipped';
  const isPaid    = !!order.paid;

  return (
    <View style={styles.orderCard}>
      {/* Order header */}
      <View style={styles.orderHeader}>
        <View style={styles.orderHeaderLeft}>
          <Text style={styles.orderDate}>{order.order_date}</Text>
          <View style={[styles.statusChip, { backgroundColor: st.bg }]}>
            <Text style={[styles.statusChipText, { color: st.color }]}>{st.label}</Text>
          </View>
          {/* Payment badge — only on shipped orders */}
          {isShipped && (
            <View style={[styles.payChip, isPaid ? styles.payChipPaid : styles.payChipUnpaid]}>
              <Text style={[styles.payChipText, { color: isPaid ? '#15803d' : '#c0392b' }]}>
                {isPaid ? '결제완료' : '미결제'}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.orderTotal}>{isAdmin ? fmt(total)+'원' : '••••원'}</Text>
      </View>

      {/* Items */}
      {(order.items || []).map((item, idx) => (
        <ItemRow
          key={idx}
          item={item}
          checked={checkedMap[`${order.id}_${idx}`] || false}
          onToggle={() => onToggle(order.id, idx)}
          isShipped={order.status === 'shipped'}
          isAdmin={isAdmin}
        />
      ))}
    </View>
  );
}

// ── Main ──────────────────────────────────────────────
export default function OrderScreen({ route, navigation }) {
  const { isAdmin } = useAuth();
  const { customer, orders } = route.params;

  const [localOrders, setLocalOrders] = useState(orders);

  // Build initial checked map (all false)
  const initMap = {};
  localOrders.forEach(o =>
    (o.items || []).forEach((_, idx) => {
      initMap[`${o.id}_${idx}`] = false;
    })
  );
  const [checkedMap, setCheckedMap] = useState(initMap);

  // ── Real-time Sync ────────────────────────────────────
  useEffect(() => {
    console.log(`🔌 Subscribing to orders for customer: ${customer.name}`);
    
    const channel = supabase.channel(`orders-${customer.id}`)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'orders',
        filter: `customer_id=eq.${customer.id}`
      }, async (payload) => {
        console.log('🔔 Real-time order update received:', payload.eventType);
        // Refresh list
        const { data } = await supabase
          .from('orders')
          .select('*')
          .eq('customer_id', customer.id)
          .order('order_date', { ascending: false });
        
        if (data) setLocalOrders(data);
      })
      .subscribe();

    return () => {
      console.log('📴 Unsubscribing from orders');
      supabase.removeChannel(channel);
    };
  }, [customer.id]);

  const pending = localOrders.filter(o => o.status !== 'shipped');
  const shipped = localOrders.filter(o => o.status === 'shipped');

  const toggle = (orderId, itemIdx) =>
    setCheckedMap(prev => ({
      ...prev,
      [`${orderId}_${itemIdx}`]: !prev[`${orderId}_${itemIdx}`],
    }));

  const toggleAll = () => {
    const allOn = Object.values(checkedMap).every(Boolean);
    const next  = {};
    Object.keys(checkedMap).forEach(k => { next[k] = !allOn; });
    setCheckedMap(next);
  };

  const getCheckedItems = () => {
    const result = [];
    localOrders.forEach(o =>
      (o.items || []).forEach((item, idx) => {
        if (checkedMap[`${o.id}_${idx}`]) result.push(item);
      })
    );
    return result;
  };

  // Collect the unique order IDs that have at least one checked item
  const getCheckedOrderIds = () => {
    const ids = new Set();
    localOrders.forEach(o =>
      (o.items || []).forEach((_, idx) => {
        if (checkedMap[`${o.id}_${idx}`]) ids.add(o.id);
      })
    );
    return [...ids];
  };

  const checkedCount = Object.values(checkedMap).filter(Boolean).length;
  const totalCount   = Object.keys(checkedMap).length;
  const allChecked   = totalCount > 0 && checkedCount === totalCount;

  const handleNext = () => {
    const items    = getCheckedItems();
    const orderIds = getCheckedOrderIds();
    if (items.length === 0) {
      Alert.alert('알림', '출고할 품목을 한 개 이상 선택하세요');
      return;
    }
    navigation.navigate('Camera', { customer, items, orderIds });
  };

  return (
    <View style={styles.root}>

      {/* ── Customer header ── */}
      <View style={styles.custHeader}>
        <View style={styles.custAvatarWrap}>
          <Text style={styles.custAvatarText}>{customer.name[0]}</Text>
        </View>
        <View style={styles.custInfo}>
          <Text style={styles.custName}>{customer.name}</Text>
          {customer.tel  && <Text style={styles.custDetail}>{customer.tel}</Text>}
          {customer.addr && <Text style={styles.custAddr} numberOfLines={1}>{customer.addr}</Text>}
        </View>
        <TouchableOpacity style={styles.selectAllBtn} onPress={toggleAll}>
          <Text style={styles.selectAllText}>{allChecked ? '전체 해제' : '전체 선택'}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Order list ── */}
      <ScrollView contentContainerStyle={styles.scroll}>

        {pending.length === 0 && (
          <View style={styles.emptySection}>
            <Text style={styles.emptyEmoji}>📭</Text>
            <Text style={styles.emptyText}>출고 대기 주문이 없습니다</Text>
          </View>
        )}

        {pending.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>⏳ 출고 대기</Text>
            {pending.map(o => (
              <OrderSection key={o.id} order={o} checkedMap={checkedMap} onToggle={toggle} isAdmin={isAdmin} />
            ))}
          </View>
        )}

        {shipped.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: C.inkMuted }]}>✅ 출고 완료</Text>
            {shipped.map(o => (
              <OrderSection key={o.id} order={o} checkedMap={checkedMap} onToggle={toggle} isAdmin={isAdmin} />
            ))}
          </View>
        )}
      </ScrollView>

      {/* ── Footer CTA ── */}
      <View style={styles.footer}>
        <View style={styles.footerSummary}>
          <Text style={styles.footerCount}>
            <Text style={{ color: C.blue, fontWeight: '700' }}>{checkedCount}</Text>
            <Text style={{ color: C.inkMuted }}> / {totalCount}개 선택</Text>
          </Text>
          {checkedCount > 0 && (
            <Text style={styles.footerTotal}>
              {isAdmin ? fmt(getCheckedItems().reduce((s,i)=>s+(i.qty||0)*(i.price||0),0))+'원' : '••••원'}
            </Text>
          )}
        </View>
        <TouchableOpacity
          style={[styles.nextBtn, checkedCount === 0 && styles.nextBtnOff]}
          onPress={handleNext}
          activeOpacity={0.85}
        >
          <Text style={styles.nextBtnText}>📷  송장 촬영</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 14, paddingBottom: 110, gap: 20 },

  // ── Customer header
  custHeader: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.darkNav,
    paddingHorizontal: 16, paddingVertical: 14, gap: 12,
  },
  custAvatarWrap: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  custAvatarText: { fontSize: 18, fontWeight: '700', color: '#fff' },
  custInfo:  { flex: 1 },
  custName:  { fontSize: 17, fontWeight: '700', color: '#fff', letterSpacing: -0.3 },
  custDetail:{ fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  custAddr:  { fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 1 },
  selectAllBtn: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  selectAllText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  // ── Section
  section:      { gap: 10 },
  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: C.blue,
    textTransform: 'uppercase', letterSpacing: 0.6,
    marginBottom: 2,
  },
  emptySection: { alignItems: 'center', paddingVertical: 52, gap: 10 },
  emptyEmoji:   { fontSize: 40 },
  emptyText:    { fontSize: 14, color: C.inkMuted },

  // ── Order card
  orderCard: {
    backgroundColor: C.canvas, borderRadius: 16,
    borderWidth: 1, borderColor: C.hairline,
    overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  orderHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 11,
    backgroundColor: '#fafafa', borderBottomWidth: 1, borderBottomColor: C.hairline,
  },
  orderHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  orderDate:   { fontSize: 13, fontWeight: '700', color: C.ink },
  statusChip:  { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  statusChipText: { fontSize: 11, fontWeight: '700' },
  orderTotal:  { fontSize: 14, fontWeight: '700', color: C.blue },

  // Payment badge
  payChip:       { borderRadius: 99, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1 },
  payChipPaid:   { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  payChipUnpaid: { backgroundColor: '#fff1f0', borderColor: '#fecaca' },
  payChipText:   { fontSize: 10, fontWeight: '700' },

  // ── Item row
  itemRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12, gap: 12,
    borderBottomWidth: 1, borderBottomColor: C.hairline,
    backgroundColor: C.canvas,
  },
  itemRowChecked: { backgroundColor: '#f5f8ff' },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 2, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  checkboxOn:   { backgroundColor: C.blue, borderColor: C.blue },
  checkmark:    { color: '#fff', fontSize: 12, fontWeight: '800' },
  itemBody:     { flex: 1 },
  itemName:     { fontSize: 14, fontWeight: '600', color: C.ink, letterSpacing: -0.1 },
  itemNameDone: { textDecorationLine: 'line-through', color: C.inkMuted },
  itemSpec:     { fontSize: 11, color: C.inkMuted, marginTop: 2 },
  itemRight:    { alignItems: 'flex-end', gap: 2 },
  itemSubtotal: { fontSize: 14, fontWeight: '700', color: C.ink },
  itemQtyPrice: { fontSize: 11, color: C.inkMuted },

  // ── Footer
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: C.canvas,
    borderTopWidth: 1, borderTopColor: C.border,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 30,
    gap: 12,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
  footerSummary: { flex: 1 },
  footerCount:   { fontSize: 14 },
  footerTotal:   { fontSize: 13, color: C.inkMuted, marginTop: 2 },
  nextBtn: {
    backgroundColor: C.blue, borderRadius: 99,
    paddingHorizontal: 22, paddingVertical: 14,
  },
  nextBtnOff:  { backgroundColor: C.inkLight },
  nextBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
