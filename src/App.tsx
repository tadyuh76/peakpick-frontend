import {
  Activity,
  BarChart3,
  Bell,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Copy,
  Layers3,
  PackageCheck,
  RefreshCw,
  ShoppingCart,
  Truck
} from "lucide-solid";
import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { peakpickApi } from "./services/api";
import type {
  AnalyticsSnapshot,
  CheckoutResponse,
  NotificationLog,
  Order,
  PickupSlot,
  PickupWindow,
  Product,
  SlotReservation,
  StaffBoardItem
} from "./services/types";

const pickupWindows = ["09:30-09:35", "12:00-12:15", "17:30-17:45"];

function App() {
  const [products, setProducts] = createSignal<Product[]>([]);
  const [quantities, setQuantities] = createSignal<Record<string, number>>({ coffee: 2, snack: 1 });
  const [customerName, setCustomerName] = createSignal("Tad");
  const [pickupWindow, setPickupWindow] = createSignal(pickupWindows[1]);
  const [checkout, setCheckout] = createSignal<CheckoutResponse | null>(null);
  const [orders, setOrders] = createSignal<Order[]>([]);
  const [board, setBoard] = createSignal<StaffBoardItem[]>([]);
  const [pickupWindowMeta, setPickupWindowMeta] = createSignal<PickupWindow[]>([]);
  const [slots, setSlots] = createSignal<PickupSlot[]>([]);
  const [reservations, setReservations] = createSignal<SlotReservation[]>([]);
  const [notifications, setNotifications] = createSignal<NotificationLog[]>([]);
  const [analytics, setAnalytics] = createSignal<AnalyticsSnapshot>({ counts: {}, recent_events: [] });
  const [pickupToken, setPickupToken] = createSignal("");
  const [slotWindowFilter, setSlotWindowFilter] = createSignal(pickupWindows[1]);
  const [busy, setBusy] = createSignal(false);
  const [notice, setNotice] = createSignal("Frontend ready");
  const [error, setError] = createSignal("");

  const latestBoardItem = createMemo(() => {
    const orderId = checkout()?.order.order_id;
    return board().find((item) => item.order_id === orderId) ?? board()[0];
  });

  const latestOrder = createMemo(() => {
    const orderId = checkout()?.order.order_id;
    return orders().find((order) => order.order_id === orderId) ?? checkout()?.order ?? orders()[0];
  });

  const selectedItems = createMemo(() =>
    products()
      .map((product) => ({ sku: product.sku, quantity: quantities()[product.sku] ?? 0 }))
      .filter((item) => item.quantity > 0)
  );

  const total = createMemo(() =>
    products().reduce((sum, product) => {
      return sum + product.price * (quantities()[product.sku] ?? 0);
    }, 0)
  );

  const filteredReservations = createMemo(() =>
    reservations().filter((reservation) => reservation.pickup_window === slotWindowFilter())
  );

  const activeReservations = createMemo(() =>
    filteredReservations().filter((reservation) => reservation.status !== "Available")
  );

  const slotCapacity = createMemo(() => {
    const window = pickupWindowMeta().find((item) => item.pickup_window === slotWindowFilter());
    return window?.capacity ?? slots().length;
  });

  const slotRows = createMemo(() =>
    slots().map((slot) => {
      const reservation = filteredReservations().find(
        (item) => item.slot_id === slot.slot_id && item.status !== "Available"
      );
      return {
        slot_id: slot.slot_id,
        status: reservation?.status ?? "Available",
        order_id: reservation?.order_id
      };
    })
  );

  onMount(async () => {
    await loadProducts();
    await refreshOperationalData();
  });

  async function runAction(label: string, action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setNotice(label);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadProducts() {
    await runAction("Catalog loaded", async () => {
      setProducts(await peakpickApi.listProducts());
    });
  }

  async function refreshOperationalData() {
    const [
      nextOrders,
      nextBoard,
      nextReservations,
      nextPickupWindows,
      nextSlots,
      nextNotifications,
      nextAnalytics
    ] = await Promise.all([
      peakpickApi.listOrders(),
      peakpickApi.getStaffBoard(),
      peakpickApi.getSlotReservations(),
      peakpickApi.getPickupWindows(),
      peakpickApi.getSlots(),
      peakpickApi.getNotifications(),
      peakpickApi.getAnalytics()
    ]);
    setOrders(nextOrders);
    setBoard(nextBoard);
    setReservations(nextReservations);
    setPickupWindowMeta(nextPickupWindows);
    setSlots(nextSlots);
    setNotifications(nextNotifications);
    setAnalytics(nextAnalytics);
    setPickupToken(latestBoardItem()?.token ?? pickupToken());
  }

  async function submitCheckout() {
    await runAction("Order paid event published", async () => {
      const response = await peakpickApi.checkout({
        customer_name: customerName(),
        pickup_window: pickupWindow(),
        items: selectedItems()
      });
      setCheckout(response);
      setPickupToken("");
      await new Promise((resolve) => setTimeout(resolve, 600));
      await refreshOperationalData();
    });
  }

  async function markPreparing() {
    const item = latestBoardItem();
    if (!item) return;
    await runAction("OrderPreparing published", async () => {
      await peakpickApi.markPreparing(item.order_id);
      await refreshOperationalData();
    });
  }

  async function markReady() {
    const item = latestBoardItem();
    if (!item) return;
    await runAction("OrderReady published", async () => {
      const updated = await peakpickApi.markReady(item.order_id);
      setPickupToken(updated.token ?? "");
      await refreshOperationalData();
    });
  }

  async function verifyPickup() {
    const item = latestBoardItem();
    const token = pickupToken() || item?.token;
    if (!item || !token) return;
    await runAction("OrderPickedUp published", async () => {
      await peakpickApi.verifyPickup(item.order_id, token);
      await refreshOperationalData();
    });
  }

  function updateQuantity(sku: string, value: number) {
    setQuantities((current) => ({ ...current, [sku]: Math.max(0, value) }));
  }

  async function copyOrderId() {
    const orderId = checkout()?.order.order_id;
    if (!orderId) return;
    await navigator.clipboard.writeText(orderId);
    setNotice("Order ID copied");
  }

  return (
    <main class="app-shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">PeakPick</p>
          <h1>Pickup operations console</h1>
        </div>
        <div class="status-strip">
          <span class="status-dot" />
          <span>{notice()}</span>
        </div>
      </header>

      <nav class="section-nav" aria-label="PeakPick console sections">
        <a href="#checkout">Checkout</a>
        <a href="#staff-board">Staff board</a>
        <a href="#events">Events</a>
        <a href="#order-detail">Order detail</a>
        <a href="#slot-capacity">Slots</a>
        <a href="#reservations">Reservations</a>
        <a href="#event-log">Event log</a>
      </nav>

      <Show when={error()}>
        <div class="alert" role="alert">
          {error()}
        </div>
      </Show>

      <section class="workspace">
        <section class="panel order-panel" id="checkout">
          <div class="panel-heading">
            <ShoppingCart size={19} />
            <h2>Checkout</h2>
          </div>

          <label>
            Customer
            <input value={customerName()} onInput={(event) => setCustomerName(event.currentTarget.value)} />
          </label>

          <label>
            Pickup window
            <select value={pickupWindow()} onChange={(event) => setPickupWindow(event.currentTarget.value)}>
              <For each={pickupWindows}>{(window) => <option value={window}>{window}</option>}</For>
            </select>
          </label>

          <div class="product-list">
            <For each={products()}>
              {(product) => (
                <div class="product-row">
                  <div>
                    <strong>{product.name}</strong>
                    <span>{formatCurrency(product.price)}</span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={quantities()[product.sku] ?? 0}
                    onInput={(event) => updateQuantity(product.sku, Number(event.currentTarget.value))}
                    aria-label={`${product.name} quantity`}
                  />
                </div>
              )}
            </For>
          </div>

          <div class="summary-line">
            <span>Total</span>
            <strong>{formatCurrency(total())}</strong>
          </div>

          <button class="primary-action" disabled={busy() || selectedItems().length === 0} onClick={submitCheckout}>
            <Truck size={18} />
            Create paid order
          </button>

          <Show when={checkout()}>
            {(result) => (
              <div class="receipt">
                <span>Order</span>
                <button class="ghost-action" onClick={copyOrderId} title="Copy order ID">
                  <Copy size={16} />
                  {shortId(result().order.order_id)}
                </button>
              </div>
            )}
          </Show>
        </section>

        <section class="panel staff-panel" id="staff-board">
          <div class="panel-heading split">
            <div>
              <PackageCheck size={19} />
              <h2>Staff board</h2>
            </div>
            <button class="icon-action" onClick={() => runAction("Board refreshed", refreshOperationalData)} title="Refresh">
              <RefreshCw size={17} />
            </button>
          </div>

          <Show when={latestBoardItem()} fallback={<p class="empty-state">No assigned slots yet.</p>}>
            {(item) => (
              <div class="board-item">
                <div class="board-main">
                  <strong>{item().slot_id}</strong>
                  <span>{item().pickup_window}</span>
                </div>
                <StatusBadge value={item().status} />
                <p>{shortId(item().order_id)}</p>
              </div>
            )}
          </Show>

          <div class="staff-actions">
            <button disabled={busy() || !latestBoardItem()} onClick={markPreparing}>
              <RefreshCw size={17} />
              Preparing
            </button>
            <button disabled={busy() || !latestBoardItem()} onClick={markReady}>
              <CheckCircle2 size={17} />
              Ready
            </button>
          </div>

          <label>
            Pickup token
            <input
              value={pickupToken()}
              onInput={(event) => setPickupToken(event.currentTarget.value)}
              placeholder="PK-XXXXXX"
            />
          </label>

          <button class="primary-action confirm" disabled={busy() || !latestBoardItem()} onClick={verifyPickup}>
            <CheckCircle2 size={18} />
            Verify pickup
          </button>

          <div class="slot-list">
            <For each={reservations().slice(0, 4)}>
              {(reservation) => (
                <div class="slot-row">
                  <span>{reservation.slot_id}</span>
                  <StatusBadge value={reservation.status} />
                </div>
              )}
            </For>
          </div>
        </section>

        <section class="panel insight-panel" id="events">
          <div class="panel-heading">
            <BarChart3 size={19} />
            <h2>Events</h2>
          </div>

          <div class="metric-grid">
            <Metric label="OrderPaid" value={analytics().counts.OrderPaid ?? 0} />
            <Metric label="SlotReserved" value={analytics().counts.PickupSlotReserved ?? 0} />
            <Metric label="Ready" value={analytics().counts.OrderReady ?? 0} />
            <Metric label="PickedUp" value={analytics().counts.OrderPickedUp ?? 0} />
          </div>

          <div class="feed">
            <h3>Notifications</h3>
            <Show when={notifications().length > 0} fallback={<p class="empty-state">No notifications yet.</p>}>
              <For each={notifications().slice(-3).reverse()}>
                {(notification) => (
                  <div class="feed-row">
                    <Bell size={16} />
                    <span>{notification.message}</span>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </section>
      </section>

      <section class="evidence-grid">
        <section class="panel order-detail-panel" id="order-detail">
          <div class="panel-heading">
            <ClipboardList size={19} />
            <h2>Order detail</h2>
          </div>

          <Show when={latestOrder()} fallback={<p class="empty-state">No paid orders yet.</p>}>
            {(order) => (
              <>
                <div class="detail-grid">
                  <Detail label="Order" value={shortId(order().order_id)} />
                  <Detail label="Payment" value={order().payment_status} />
                  <Detail label="Status" value={order().order_status} />
                  <Detail label="Window" value={order().pickup_window} />
                </div>

                <div class="timeline">
                  <For each={orderSteps}>
                    {(step) => (
                      <div class={`timeline-step ${isStepReached(order().order_status, step) ? "active" : ""}`}>
                        <span />
                        <p>{step}</p>
                      </div>
                    )}
                  </For>
                </div>

                <div class="item-stack">
                  <For each={order().items}>
                    {(item) => (
                      <div class="compact-row">
                        <span>{item.sku}</span>
                        <strong>x{item.quantity}</strong>
                      </div>
                    )}
                  </For>
                </div>
              </>
            )}
          </Show>
        </section>

        <section class="panel slot-dashboard-panel" id="slot-capacity">
          <div class="panel-heading split">
            <div>
              <Layers3 size={19} />
              <h2>Slot capacity</h2>
            </div>
            <select
              class="compact-select"
              value={slotWindowFilter()}
              onChange={(event) => setSlotWindowFilter(event.currentTarget.value)}
            >
              <For each={pickupWindows}>{(window) => <option value={window}>{window}</option>}</For>
            </select>
          </div>

          <div class="capacity-strip">
            <Metric label="Capacity" value={slotCapacity()} />
            <Metric label="Used" value={activeReservations().length} />
            <Metric label="Available" value={Math.max(slotCapacity() - activeReservations().length, 0)} />
          </div>

          <div class="slot-grid">
            <For each={slotRows()}>
              {(slot) => (
                <div class={`slot-tile ${slot.status.toLowerCase()}`}>
                  <strong>{slot.slot_id}</strong>
                  <span>{slot.status}</span>
                  <Show when={slot.order_id}>{(orderId) => <small>{shortId(orderId())}</small>}</Show>
                </div>
              )}
            </For>
          </div>
        </section>

        <section class="panel reservation-panel" id="reservations">
          <div class="panel-heading">
            <CalendarClock size={19} />
            <h2>Reservations</h2>
          </div>

          <Show when={reservations().length > 0} fallback={<p class="empty-state">No reservations yet.</p>}>
            <div class="table-list">
              <For each={reservations().slice(0, 8)}>
                {(reservation) => (
                  <div class="reservation-row">
                    <span>{shortId(reservation.order_id)}</span>
                    <strong>{reservation.slot_id}</strong>
                    <span>{reservation.pickup_window}</span>
                    <StatusBadge value={reservation.status} />
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>

        <section class="panel event-log-panel" id="event-log">
          <div class="panel-heading">
            <Activity size={19} />
            <h2>Recent events</h2>
          </div>

          <Show when={analytics().recent_events.length > 0} fallback={<p class="empty-state">No events yet.</p>}>
            <div class="event-list">
              <For each={analytics().recent_events.slice(-8).reverse()}>
                {(event) => (
                  <div class="event-row">
                    <strong>{event.event_type}</strong>
                    <span>{shortId(event.aggregate_id)}</span>
                    <small>{event.source}</small>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>
      </section>
    </main>
  );
}

const orderSteps = ["Paid", "SlotAssigned", "Preparing", "ReadyForPickup", "Completed"];

const orderStepRank: Record<string, number> = {
  Paid: 0,
  SlotAssigned: 1,
  Preparing: 2,
  PlacedInSlot: 3,
  ReadyForPickup: 4,
  Completed: 5
};

function Metric(props: { label: string; value: number }) {
  return (
    <div class="metric">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function Detail(props: { label: string; value: string }) {
  return (
    <div class="detail">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function StatusBadge(props: { value: string }) {
  return <span class={`status-badge ${props.value.toLowerCase()}`}>{props.value}</span>;
}

function isStepReached(status: string, step: string) {
  const statusRank = orderStepRank[status] ?? -1;
  const stepRank = orderStepRank[step] ?? 0;
  return statusRank >= stepRank;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(value);
}

function shortId(value: string) {
  return value.replace("order-", "").slice(0, 8);
}

export default App;
