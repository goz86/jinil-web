import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert,
} from 'react-native';
import { fmt, orderTotal, C, supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import OrderStepper from '../components/OrderStepper';

const STATUS = {
  new:     { label: '신규',     color: C.blue,    bg: C.blueLight  },
  pending: { label: '출고대기', color: '#b36a00', bg: '#fff7ed'    },
  shipped: { label: '출고완료', color: '#1a7f2a', bg: '#f0fdf4'    },
  partial: { label: '부분출고', color: '#7c3aed', bg: '#f5f3ff'    },
};

// ── Checkbox item row ─────────────────────────────────
function ItemRow({ item, checked, onToggle, isShipped, itemShipped, isAdmin }) {
  const isDone = checked || isShipped || itemShipped;
  const isDisabled = isShipped || itemShipped;
  return (
    <TouchableOpacity
      style={[styles.itemRow, checked && styles.itemRowChecked, itemShipped && { backgroundColor: '#fafafa' }]}
      onPress={onToggle}
      activeOpacity={0.7}
      disabled={isDisabled}
    >
      <View style={[styles.checkbox, isDone && styles.checkboxOn, isDisabled && { opacity: 0.45 }]}>
        {isDone && <Text style={styles.checkmark}>✓</Text>}
      </View>

      <View style={styles.itemBody}>
        <Text style={[
          styles.itemName,
          isDone && styles.itemNameDone,
          itemShipped && { textDecorationLine: 'line-through', color: C.inkMuted },
        ]} numberOfLines={1}>
          {item.name}
          {itemShipped ? '  ✓출고' : ''}
        </Text>
        {item.spec ? <Text style={styles.itemSpec}>{item.spec}</Text> : null}
      </View>

      <View style={styles.itemRight}>
        <Text style={[styles.itemSubtotal, itemShipped && { color: C.inkMuted, textDecorationLine: 'line-through' }]}>
          {isAdmin ? fmt(item.qty * item.price)+'원' : '••••원'}
        </Text>
        <Text style={styles.itemQtyPrice}>× {item.qty}개{isAdmin ? ` · ${fmt(item.price)}원` : ''}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Order group ───────────────────────────────────────
function OrderSection({ order, checkedMap, onToggle, isAdmin }) {
  // 부분출고 감지: status 대신 items JSON으로 판단 (DB constraint 우회)
  const hasPartialItems = (order.items || []).some(i => i.shipped === true);
  const isPartial = hasPartialItems && order.status !== 'shipped';
  const effectiveStatus = isPartial ? 'partial' : (order.status || 'new');
  const st    = STATUS[effectiveStatus] || STATUS.new;
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
          itemShipped={item.shipped === true}
          isAdmin={isAdmin}
        />
      ))}
    </View>
  );
}

// ── Main ──────────────────────────────────────────────
export default function OrderScreen({ route, navigation }) {
  const { isAdmin } = useAuth();
  const { customer, orders, allIds: groupIds } = route.params;
  // allIds = mọi customer_id cùng tên (nhiều địa chỉ → nhiều records)
  const allIds = (groupIds && groupIds.length > 0) ? groupIds : [customer.id];

  const [localOrders, setLocalOrders] = useState(orders);

  // Build initial checked map (all false) — lazy initializer runs once
  const [checkedMap, setCheckedMap] = useState(() => {
    const m = {};
    orders.forEach(o =>
      (o.items || []).forEach((_, idx) => { m[`${o.id}_${idx}`] = false; })
    );
    return m;
  });

  // Keep checkedMap in sync when real-time updates change localOrders
  // Preserves existing checked states; prunes stale keys
  useEffect(() => {
    setCheckedMap(prev => {
      const next = {};
      localOrders.forEach(o =>
        (o.items || []).forEach((_, idx) => {
          const k = `${o.id}_${idx}`;
          next[k] = prev[k] ?? false;
        })
      );
      return next;
    });
  }, [localOrders]);

  // ── Real-time Sync ────────────────────────────────────
  const idsKey = allIds.join(',');
  const refreshGroupOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .in('customer_id', allIds)
      .order('order_date', { ascending: false });

    if (error) {
      console.warn('Group order refresh error:', error.message);
      return;
    }
    if (data) setLocalOrders(data);
  }, [idsKey]);

  useEffect(() => {
    console.log(`🔌 Subscribing to orders for group: ${customer.name} (ids: ${allIds.join(',')})`);

    // Supabase Realtime filter supports IN operator: customer_id=in.(id1,id2,...)
    const realtimeFilter = allIds.length === 1
      ? `customer_id=eq.${allIds[0]}`
      : `customer_id=in.(${allIds.join(',')})`;

    const channelName = `orders-group-${allIds.slice().sort().join('-')}`;

    const channel = supabase.channel(channelName)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: realtimeFilter,
      }, async () => {
        console.log('🔔 Real-time order update — refreshing all group orders');
        await refreshGroupOrders();
      })
      .subscribe();

    const broadcastChannel = supabase.channel('jinil-sync')
      .on('broadcast', { event: 'orders_changed' }, async () => {
        console.log('Order broadcast detected, refreshing group orders...');
        await refreshGroupOrders();
      })
      .on('broadcast', { event: 'data_changed' }, async () => {
        console.log('Data broadcast detected, refreshing group orders...');
        await refreshGroupOrders();
      })
      .subscribe();

    const timer = setInterval(refreshGroupOrders, 3000);

    return () => {
      console.log('📴 Unsubscribing from orders group');
      clearInterval(timer);
      supabase.removeChannel(channel);
      supabase.removeChannel(broadcastChannel);
    };
  }, [idsKey, refreshGroupOrders]);

  const pending = localOrders.filter(o => o.status !== 'shipped');
  const shipped = localOrders.filter(o => o.status === 'shipped');

  const toggle = (orderId, itemIdx) =>
    setCheckedMap(prev => ({
      ...prev,
      [`${orderId}_${itemIdx}`]: !prev[`${orderId}_${itemIdx}`],
    }));

  // Determine overall status for the group stepper
  const groupStatus = localOrders.length === 0 ? 'new' :
                     localOrders.every(o => o.status === 'shipped') ? 'shipped' : 
                     localOrders.some(o => o.status === 'pending' || o.status === 'partial') ? 'pending' : 'new';
  const groupIsPaid = localOrders.length > 0 && localOrders.every(o => !!o.paid);

  // Only toggle non-shipped order items
  const toggleAll = () => {
    const pendingKeys = [];
    localOrders
      .filter(o => o.status !== 'shipped')
      .forEach(o =>
        (o.items || []).forEach((_, idx) => pendingKeys.push(`${o.id}_${idx}`))
      );
    const allOn = pendingKeys.length > 0 && pendingKeys.every(k => checkedMap[k]);
    setCheckedMap(prev => {
      const next = { ...prev };
      pendingKeys.forEach(k => { next[k] = !allOn; });
      return next;
    });
  };

  // Collect checked items (exclude already item-shipped); include order/index metadata
  const getCheckedItems = () => {
    const result = [];
    localOrders
      .filter(o => o.status !== 'shipped')
      .forEach(o =>
        (o.items || []).forEach((item, idx) => {
          if (!item.shipped && checkedMap[`${o.id}_${idx}`])
            result.push({ ...item, _orderId: o.id, _itemIdx: idx });
        })
      );
    return result;
  };

  // fullyChecked: all unshipped items of order selected → mark full order shipped
  // partialChecked: only some items selected → partial shipment
  // partialDetails: [{orderId, itemIdxs}] — which item indices to mark shipped
  const getCheckedOrderIds = () => {
    const fullyChecked   = [];
    const partialChecked = [];
    const partialDetails = [];
    localOrders
      .filter(o => o.status !== 'shipped')
      .forEach(o => {
        // Only count unshipped items as "available to ship"
        const unshippedTotal = (o.items || []).filter(it => !it.shipped).length;
        const checkedIdxs = (o.items || [])
          .map((item, idx) => ({ item, idx }))
          .filter(({ item, idx }) => !item.shipped && checkedMap[`${o.id}_${idx}`])
          .map(({ idx }) => idx);
        const checked = checkedIdxs.length;
        if (checked === 0) return;
        if (checked === unshippedTotal) {
          fullyChecked.push(o.id);
        } else {
          partialChecked.push(o.id);
          partialDetails.push({ orderId: o.id, itemIdxs: checkedIdxs });
        }
      });
    return { fullyChecked, partialChecked, partialDetails };
  };

  // Count only unshipped items (exclude item.shipped) for footer display
  const pendingKeys = [];
  localOrders
    .filter(o => o.status !== 'shipped')
    .forEach(o => (o.items || []).forEach((item, idx) => {
      if (!item.shipped) pendingKeys.push(`${o.id}_${idx}`);
    }));
  const checkedCount = pendingKeys.filter(k => checkedMap[k]).length;
  const totalCount   = pendingKeys.length;
  const allChecked   = totalCount > 0 && checkedCount === totalCount;

  const handleNext = () => {
    const items = getCheckedItems();
    if (items.length === 0) {
      Alert.alert('알림', '출고할 품목을 한 개 이상 선택하세요');
      return;
    }
    // fullyChecked  → orders whose ALL items are selected → will be marked shipped
    // partialChecked → orders with only some items selected → stay pending
    const { fullyChecked, partialChecked, partialDetails } = getCheckedOrderIds();
    const orderIds = [...fullyChecked, ...partialChecked];
    navigation.navigate('Camera', { customer, items, orderIds, fullyChecked, partialDetails });
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
        
        {/* Pro VIP Stepper (Minimalist) */}
        <OrderStepper status={groupStatus} isPaid={groupIsPaid} />

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
  scroll: { padding: 14, paddingBottom: 130, gap: 20 },

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
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48,
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
