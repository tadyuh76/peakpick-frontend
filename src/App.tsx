import {
  Activity,
  BarChart3,
  Bell,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Copy,
  CreditCard,
  Layers3,
  PackageCheck,
  RefreshCw,
  ShoppingCart,
  TicketCheck,
} from "lucide-solid";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
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
type RouteId = "customer" | "admin";
const navItems = [
  { id: "customer" as const, label: "Customer", path: "/user" },
  { id: "admin" as const, label: "Admin", path: "/admin" }
] satisfies Array<{ id: RouteId; label: string; path: string }>;

function App() {
  const [activeView, setActiveView] = createSignal<RouteId>(routeFromPath(window.location.pathname));
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
  const [selectedOrderId, setSelectedOrderId] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [initialLoading, setInitialLoading] = createSignal(true);
  const [notice, setNotice] = createSignal("Frontend ready");
  const [error, setError] = createSignal("");
  const [dataErrors, setDataErrors] = createSignal<Record<string, string>>({});

  const pickupWindowOptions = createMemo(() => {
    const activeWindows = pickupWindowMeta().filter((item) => item.active);
    const windows =
      activeWindows.length > 0
        ? activeWindows
        : pickupWindows.map((window) => ({ pickup_window: window, capacity: slots().length || 8, active: true }));
    return windows.map((window) => {
      const used = reservations().filter(
        (reservation) => reservation.pickup_window === window.pickup_window && reservation.status !== "Available"
      ).length;
      return {
        pickup_window: window.pickup_window,
        capacity: window.capacity,
        used,
        available: Math.max(window.capacity - used, 0)
      };
    });
  });

  const selectablePickupWindows = createMemo(() => pickupWindowOptions().filter((window) => window.available > 0));

  const selectedPickupWindowOption = createMemo(() => {
    return pickupWindowOptions().find((window) => window.pickup_window === pickupWindow());
  });

  const customerOrder = createMemo(() => {
    const orderId = checkout()?.order.order_id;
    if (!orderId) return null;
    return orders().find((order) => order.order_id === orderId) ?? checkout()?.order ?? null;
  });

  const customerBoardItem = createMemo(() => {
    const orderId = checkout()?.order.order_id;
    if (!orderId) return null;
    return board().find((item) => item.order_id === orderId) ?? null;
  });

  const selectedBoardItem = createMemo(() => {
    const orderId = selectedOrderId();
    if (!orderId) return null;
    return board().find((item) => item.order_id === orderId) ?? null;
  });

  const selectedOrder = createMemo(() => {
    const orderId = selectedOrderId();
    if (!orderId) return null;
    return orders().find((order) => order.order_id === orderId) ?? null;
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

  const hasCheckoutInput = createMemo(
    () => customerName().trim().length > 0 && selectedItems().length > 0 && (selectedPickupWindowOption()?.available ?? 0) > 0
  );

  const pageTitle = createMemo(() =>
    activeView() === "customer" ? "Customer pickup order" : "Admin order and slot console"
  );

  const canMarkPreparing = createMemo(() => {
    const status = selectedBoardItem()?.status;
    return status === "SlotAssigned";
  });

  const canMarkReady = createMemo(() => {
    const status = selectedBoardItem()?.status;
    return status === "Preparing" || status === "PlacedInSlot";
  });

  const canVerifyPickup = createMemo(
    () => selectedBoardItem()?.status === "ReadyForPickup" && pickupToken().trim().length > 0
  );

  const slotDashboardRows = createMemo(() =>
    pickupWindowOptions().map((window) => {
      const windowReservations = reservations().filter((reservation) => reservation.pickup_window === window.pickup_window);
      const activeReservations = windowReservations.filter((reservation) => reservation.status !== "Available");
      const slotRows = slots().map((slot) => {
        const reservation = windowReservations.find(
          (item) => item.slot_id === slot.slot_id && item.status !== "Available"
        );
        return {
          slot_id: slot.slot_id,
          status: reservation?.status ?? "Available",
          order_id: reservation?.order_id
        };
      });
      return {
        pickup_window: window.pickup_window,
        capacity: window.capacity,
        used: activeReservations.length,
        available: Math.max(window.capacity - activeReservations.length, 0),
        slotRows
      };
    })
  );

  const syncRoute = () => setActiveView(routeFromPath(window.location.pathname));

  onMount(async () => {
    window.addEventListener("popstate", syncRoute);
    try {
      await loadProducts();
      await refreshOperationalData();
    } finally {
      setInitialLoading(false);
    }
  });

  onCleanup(() => {
    window.removeEventListener("popstate", syncRoute);
  });

  createEffect(() => {
    const currentSelection = selectedOrderId();
    if (currentSelection && board().some((item) => item.order_id === currentSelection)) return;
    setSelectedOrderId(board()[0]?.order_id ?? "");
  });

  createEffect(() => {
    const item = selectedBoardItem();
    setPickupToken(item?.token ?? "");
  });

  createEffect(() => {
    const current = selectedPickupWindowOption();
    const firstAvailable = selectablePickupWindows()[0];
    if ((current?.available ?? 0) > 0 || !firstAvailable) return;
    setPickupWindow(firstAvailable.pickup_window);
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
    const loaded = await loadResource("Catalog", peakpickApi.listProducts, setProducts);
    if (loaded) setNotice("Catalog loaded");
  }

  async function refreshOperationalData() {
    await Promise.all([
      loadResource("Orders", peakpickApi.listOrders, setOrders),
      loadResource("Staff board", peakpickApi.getStaffBoard, setBoard),
      loadResource("Reservations", peakpickApi.getSlotReservations, setReservations),
      loadResource("Pickup windows", peakpickApi.getPickupWindows, setPickupWindowMeta),
      loadResource("Slots", peakpickApi.getSlots, setSlots),
      loadResource("Notifications", peakpickApi.getNotifications, setNotifications),
      loadResource("Analytics", peakpickApi.getAnalytics, setAnalytics)
    ]);
  }

  async function loadResource<T>(key: string, request: () => Promise<T>, setter: (value: T) => void) {
    try {
      setter(await request());
      setDataErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return true;
    } catch (err) {
      setDataErrors((current) => ({
        ...current,
        [key]: err instanceof Error ? err.message : "Request failed"
      }));
      return false;
    }
  }

  async function submitCheckout() {
    await runAction("Order paid event published", async () => {
      const response = await peakpickApi.checkout({
        customer_name: customerName(),
        pickup_window: pickupWindow(),
        items: selectedItems()
      });
      setCheckout(response);
      setSelectedOrderId(response.order.order_id);
      setPickupToken("");
      await new Promise((resolve) => setTimeout(resolve, 600));
      await refreshOperationalData();
    });
  }

  async function markPreparing() {
    const item = selectedBoardItem();
    if (!item) return;
    await runAction("OrderPreparing published", async () => {
      await peakpickApi.markPreparing(item.order_id);
      await refreshOperationalData();
    });
  }

  async function markReady() {
    const item = selectedBoardItem();
    if (!item) return;
    await runAction("OrderReady published", async () => {
      const updated = await peakpickApi.markReady(item.order_id);
      setPickupToken(updated.token ?? "");
      await refreshOperationalData();
    });
  }

  async function verifyPickup() {
    const item = selectedBoardItem();
    const token = pickupToken().trim() || item?.token;
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

  function navigateToRoute(route: RouteId, path: string) {
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
    setActiveView(route);
  }

  return (
    <main class="app-shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">PeakPick</p>
          <h1>{pageTitle()}</h1>
        </div>
        <div class="status-strip">
          <span class="status-dot" />
          <span>{notice()}</span>
        </div>
      </header>

      <nav class="section-nav" aria-label="PeakPick role links">
        <For each={navItems}>
          {(item) => (
            <a
              class={activeView() === item.id ? "active" : ""}
              href={item.path}
              onClick={(event) => {
                event.preventDefault();
                navigateToRoute(item.id, item.path);
              }}
            >
              {item.label}
            </a>
          )}
        </For>
      </nav>

      <Show when={error()}>
        <div class="alert" role="alert">
          {error()}
        </div>
      </Show>

      <Show when={Object.keys(dataErrors()).length > 0}>
        <div class="module-alert" role="status">
          <strong>Some services are unavailable.</strong>
          <span>{Object.keys(dataErrors()).join(", ")}</span>
        </div>
      </Show>

      <section class={`customer-grid view-section ${activeView() === "customer" ? "active" : ""}`}>
        <section class="panel order-panel" id="checkout">
          <div class="panel-heading">
            <ShoppingCart size={19} />
            <h2>Browse and checkout</h2>
          </div>

          <label>
            Customer
            <input value={customerName()} onInput={(event) => setCustomerName(event.currentTarget.value)} />
          </label>

          <label>
            Pickup window
            <select value={pickupWindow()} onChange={(event) => setPickupWindow(event.currentTarget.value)}>
              <For each={pickupWindowOptions()}>
                {(window) => (
                  <option value={window.pickup_window} disabled={window.available <= 0}>
                    {window.pickup_window} - {window.available} slots left
                  </option>
                )}
              </For>
            </select>
          </label>

          <div class="product-list">
            <Show
              when={!initialLoading() && products().length > 0}
              fallback={<p class="empty-state">{initialLoading() ? "Loading products..." : "No products available."}</p>}
            >
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
            </Show>
          </div>

          <div class="summary-line">
            <span>Total</span>
            <strong>{formatCurrency(total())}</strong>
          </div>

          <button class="primary-action" disabled={busy() || !hasCheckoutInput()} onClick={submitCheckout}>
            <CreditCard size={18} />
            Create paid order
          </button>
          <Show when={!hasCheckoutInput()}>
            <p class="helper-text">
              Enter a customer name, choose at least one item, and pick a window with available slots.
            </p>
          </Show>

          <Show when={checkout()}>
            {(result) => (
              <div class="receipt success">
                <span>Paid order created</span>
                <button class="ghost-action" onClick={copyOrderId} title="Copy order ID">
                  <Copy size={16} />
                  {shortId(result().order.order_id)}
                </button>
              </div>
            )}
          </Show>
        </section>

        <section class="panel customer-status-panel">
          <div class="panel-heading">
            <ClipboardList size={19} />
            <h2>Pickup status</h2>
          </div>

          <Show when={customerOrder()} fallback={<p class="empty-state">Place an order to track your pickup.</p>}>
            {(order) => (
              <>
                <div class="pickup-card">
                  <div>
                    <span>Pickup slot</span>
                    <strong>{pickupSlotLabel(order().order_status, customerBoardItem())}</strong>
                  </div>
                  <StatusBadge value={customerBoardItem()?.status ?? order().order_status} />
                </div>

                <div class="detail-grid">
                  <Detail label="Order ID" value={order().order_id} />
                  <Detail label="Window" value={order().pickup_window} />
                  <Detail label="Assigned slot" value={pickupSlotLabel(order().order_status, customerBoardItem())} />
                  <Detail label="Current status" value={customerBoardItem()?.status ?? order().order_status} />
                  <Detail label="Payment" value={order().payment_status} />
                  <Detail label="Pickup token" value={customerBoardItem()?.token ?? "Not ready"} />
                </div>

                <Show when={order().order_status === "SlotAssignmentFailed"}>
                  <p class="empty-state">No pickup slot is available for that window. Please create a new order with another pickup window.</p>
                </Show>

                <div class="timeline">
                  <For each={orderSteps}>
                    {(step) => (
                      <div
                        class={`timeline-step ${isStepReached(customerBoardItem()?.status ?? order().order_status, step) ? "active" : ""}`}
                      >
                        <span />
                        <p>{step}</p>
                      </div>
                    )}
                  </For>
                </div>

                <Show when={customerBoardItem()?.token}>
                  {(token) => (
                <div class="token-card">
                      <div>
                        <span>QR pickup code</span>
                        <strong>{token()}</strong>
                      </div>
                      <PickupCode token={token()} />
                    </div>
                  )}
                </Show>
              </>
            )}
          </Show>
        </section>
      </section>

      <section class={`admin-grid view-section ${activeView() === "admin" ? "active" : ""}`}>
        <section class="panel staff-panel" id="staff-board">
          <div class="panel-heading split">
            <div>
              <PackageCheck size={19} />
              <h2>Staff workflow</h2>
            </div>
            <button class="icon-action" onClick={() => runAction("Board refreshed", refreshOperationalData)} title="Refresh">
              <RefreshCw size={17} />
            </button>
          </div>

          <Show when={board().length > 0} fallback={<p class="empty-state">No assigned slots yet.</p>}>
            <div class="board-list">
              <For each={board()}>
                {(item) => (
                  <button
                    class={`board-item ${selectedOrderId() === item.order_id ? "selected" : ""}`}
                    type="button"
                    onClick={() => setSelectedOrderId(item.order_id)}
                  >
                    <div class="board-main">
                      <strong>{item.slot_id}</strong>
                      <span>{item.pickup_window}</span>
                    </div>
                    <StatusBadge value={item.status} />
                    <p>{shortId(item.order_id)}</p>
                  </button>
                )}
              </For>
            </div>
          </Show>

          <Show when={selectedBoardItem()}>
            {(item) => (
              <div class="selected-order-card">
                <Detail label="Selected order" value={item().order_id} />
                <Detail label="Slot" value={item().slot_id} />
                <Detail label="Window" value={item().pickup_window} />
                <Detail label="Status" value={item().status} />
              </div>
            )}
          </Show>

          <div class="staff-actions">
            <button disabled={busy() || !canMarkPreparing()} onClick={markPreparing}>
              <RefreshCw size={17} />
              Preparing
            </button>
            <button disabled={busy() || !canMarkReady()} onClick={markReady}>
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
              disabled={!selectedBoardItem()}
            />
          </label>

          <button class="primary-action confirm" disabled={busy() || !canVerifyPickup()} onClick={verifyPickup}>
            <TicketCheck size={18} />
            Verify pickup
          </button>

          <p class="helper-text">Controls unlock only for the selected order's next valid lifecycle step.</p>
        </section>

        <section class="panel insight-panel" id="events">
          <div class="panel-heading">
            <BarChart3 size={19} />
            <h2>System evidence</h2>
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

        <section class="panel order-detail-panel" id="order-detail">
          <div class="panel-heading">
            <ClipboardList size={19} />
            <h2>Order detail</h2>
          </div>

          <Show when={selectedOrder()} fallback={<p class="empty-state">Select an assigned order to inspect order detail.</p>}>
            {(order) => (
              <>
                <div class="detail-grid">
                  <Detail label="Order ID" value={order().order_id} />
                  <Detail label="Payment" value={order().payment_status} />
                  <Detail label="Order status" value={order().order_status} />
                  <Detail label="Window" value={order().pickup_window} />
                </div>

                <div class="timeline">
                  <For each={orderSteps}>
                    {(step) => (
                      <div
                        class={`timeline-step ${isStepReached(selectedBoardItem()?.status ?? order().order_status, step) ? "active" : ""}`}
                      >
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
          <div class="panel-heading">
            <Layers3 size={19} />
            <h2>Slot capacity by pickup window</h2>
          </div>

          <For each={slotDashboardRows()}>
            {(window) => (
              <div class="window-capacity">
                <div class="window-title">
                  <h3>{window.pickup_window}</h3>
                  <span>{window.used}/{window.capacity} used</span>
                </div>
                <div class="capacity-strip">
                  <Metric label="Capacity" value={window.capacity} />
                  <Metric label="Used" value={window.used} />
                  <Metric label="Available" value={window.available} />
                </div>
                <div class="slot-grid">
                  <For each={window.slotRows}>
                    {(slot) => (
                      <div class={`slot-tile ${slot.status.toLowerCase()}`}>
                        <strong>{slot.slot_id}</strong>
                        <span>{slot.status}</span>
                        <Show when={slot.order_id}>{(orderId) => <small>{shortId(orderId())}</small>}</Show>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
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

function pickupSlotLabel(orderStatus: string, boardItem: StaffBoardItem | null) {
  if (boardItem?.slot_id) return boardItem.slot_id;
  if (orderStatus === "SlotAssignmentFailed") return "No slot";
  return "Assigning";
}

function PickupCode(props: { token: string }) {
  const cells = createMemo(() => pickupCodeCells(props.token));
  return (
    <div class="pickup-code" aria-label={`Pickup QR-style code for ${props.token}`}>
      <For each={cells()}>
        {(filled) => <span class={filled ? "filled" : ""} />}
      </For>
    </div>
  );
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

function routeFromPath(pathname: string): RouteId {
  return pathname.startsWith("/admin") ? "admin" : "customer";
}

function pickupCodeCells(token: string) {
  let seed = 0;
  for (const character of token) {
    seed = (seed * 31 + character.charCodeAt(0)) >>> 0;
  }
  return Array.from({ length: 49 }, (_, index) => {
    const row = Math.floor(index / 7);
    const col = index % 7;
    const finder =
      (row <= 1 && col <= 1) ||
      (row <= 1 && col >= 5) ||
      (row >= 5 && col <= 1);
    if (finder) return true;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % 3 !== 0;
  });
}

export default App;
