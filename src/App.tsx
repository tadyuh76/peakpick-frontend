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
const LAST_CUSTOMER_ORDER_KEY = "peakpick:last-customer-order-id";
const CUSTOMER_ORDER_IDS_KEY = "peakpick:customer-order-ids";
const CUSTOMER_STATUS_SYNC_MS = 3000;
const ADMIN_STATUS_SYNC_MS = 3000;
type RouteId = "customer" | "admin";
type AdminTabId = "detail" | "evidence" | "capacity" | "reservations" | "events";
type AdminToast = {
  title: string;
  body: string;
  orderId: string;
};
const routeLinks = {
  customer: { id: "customer" as const, label: "khách hàng", path: "/user" },
  admin: { id: "admin" as const, label: "quản trị", path: "/admin" }
};
const adminTabs = [
  { id: "detail" as const, label: "Đơn hàng" },
  { id: "evidence" as const, label: "Hệ thống" },
  { id: "capacity" as const, label: "Công suất" },
  { id: "reservations" as const, label: "Lịch giữ ô" },
  { id: "events" as const, label: "Nhật ký" }
] satisfies Array<{ id: AdminTabId; label: string }>;

function App() {
  const [activeView, setActiveView] = createSignal<RouteId>(routeFromPath(window.location.pathname));
  const [products, setProducts] = createSignal<Product[]>([]);
  const [quantities, setQuantities] = createSignal<Record<string, number>>({ coffee: 2, snack: 1 });
  const [customerName, setCustomerName] = createSignal("Tấn");
  const [pickupWindow, setPickupWindow] = createSignal(pickupWindows[1]);
  const [checkout, setCheckout] = createSignal<CheckoutResponse | null>(null);
  const [customerOrderId, setCustomerOrderId] = createSignal(
    window.localStorage.getItem(LAST_CUSTOMER_ORDER_KEY) ?? ""
  );
  const [customerOrderIds, setCustomerOrderIds] = createSignal(readCustomerOrderIds());
  const [orders, setOrders] = createSignal<Order[]>([]);
  const [board, setBoard] = createSignal<StaffBoardItem[]>([]);
  const [pickupWindowMeta, setPickupWindowMeta] = createSignal<PickupWindow[]>([]);
  const [slots, setSlots] = createSignal<PickupSlot[]>([]);
  const [reservations, setReservations] = createSignal<SlotReservation[]>([]);
  const [notifications, setNotifications] = createSignal<NotificationLog[]>([]);
  const [analytics, setAnalytics] = createSignal<AnalyticsSnapshot>({ counts: {}, recent_events: [] });
  const [pickupToken, setPickupToken] = createSignal("");
  const [selectedOrderId, setSelectedOrderId] = createSignal("");
  const [activeAdminTab, setActiveAdminTab] = createSignal<AdminTabId>("detail");
  const [busy, setBusy] = createSignal(false);
  const [autoRefreshing, setAutoRefreshing] = createSignal(false);
  const [initialLoading, setInitialLoading] = createSignal(true);
  const [notice, setNotice] = createSignal("Giao diện đã sẵn sàng");
  const [error, setError] = createSignal("");
  const [dataErrors, setDataErrors] = createSignal<Record<string, string>>({});
  const [seenAdminOrderIds, setSeenAdminOrderIds] = createSignal<string[]>([]);
  const [adminOrderBaselineReady, setAdminOrderBaselineReady] = createSignal(false);
  const [adminToast, setAdminToast] = createSignal<AdminToast | null>(null);
  const [capacityDrafts, setCapacityDrafts] = createSignal<Record<string, string>>({});
  let adminToastTimer: number | undefined;

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
    const orderId = customerOrderId() || checkout()?.order.order_id;
    if (!orderId) return null;
    return orders().find((order) => order.order_id === orderId) ?? checkout()?.order ?? null;
  });

  const customerOrders = createMemo(() => {
    const trackedIds = customerOrderIds();
    const currentCheckout = checkout()?.order;
    return trackedIds
      .map((orderId) => orders().find((order) => order.order_id === orderId) ?? (currentCheckout?.order_id === orderId ? currentCheckout : null))
      .filter((order): order is Order => Boolean(order));
  });

  const customerBoardItem = createMemo(() => {
    const orderId = customerOrderId() || checkout()?.order.order_id;
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

  const selectedOrderBoardItem = createMemo(() => {
    const orderId = selectedOrderId();
    if (!orderId) return null;
    return board().find((item) => item.order_id === orderId) ?? null;
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
    activeView() === "customer" ? "Đặt hàng nhận tại quầy" : "Quản trị đơn nhận hàng"
  );
  const roleSwitchLink = createMemo(() => (activeView() === "customer" ? routeLinks.admin : routeLinks.customer));

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

  const actionHint = createMemo(() => {
    const boardItem = selectedOrderBoardItem();
    const order = selectedOrder();
    if (!order) return "Chọn một đơn để xem thao tác xử lý.";
    if (!boardItem) {
      if (order.order_status === "SlotAssignmentFailed") {
        return "Đơn chưa được gán ô nhận nên không thể xử lý tại quầy.";
      }
      return "Đơn không có trong hàng chờ vận hành hiện tại. Nếu Docker vừa recreate service, store-ops board có thể đã bị reset.";
    }
    if (boardItem.status === "SlotAssigned") return "Bước tiếp theo: bắt đầu chuẩn bị đơn.";
    if (boardItem.status === "Preparing" || boardItem.status === "PlacedInSlot") return "Bước tiếp theo: báo đơn đã sẵn sàng nhận.";
    if (boardItem.status === "ReadyForPickup") return "Đối chiếu mã nhận hàng với khách rồi xác nhận.";
    if (boardItem.status === "Completed") return "Đơn đã hoàn tất, không còn thao tác tiếp theo.";
    return "Các nút chỉ mở khi đơn đang ở đúng bước tiếp theo.";
  });

  const nextOrderAction = createMemo(() => {
    const boardItem = selectedOrderBoardItem();
    if (!boardItem) return null;
    if (boardItem.status === "SlotAssigned") {
      return {
        label: "Bắt đầu chuẩn bị",
        icon: RefreshCw,
        disabled: busy(),
        action: markPreparing
      };
    }
    if (boardItem.status === "Preparing" || boardItem.status === "PlacedInSlot") {
      return {
        label: "Báo sẵn sàng nhận",
        icon: CheckCircle2,
        disabled: busy(),
        action: markReady
      };
    }
    if (boardItem.status === "ReadyForPickup") {
      return {
        label: "Xác nhận khách đã nhận",
        icon: TicketCheck,
        disabled: busy() || !pickupToken().trim(),
        action: verifyPickup
      };
    }
    return null;
  });

  const slotDashboardRows = createMemo(() =>
    pickupWindowOptions().map((window) => {
      const windowReservations = reservations().filter((reservation) => reservation.pickup_window === window.pickup_window);
      const activeReservations = windowReservations.filter((reservation) => reservation.status !== "Available");
      const highestActiveSlot = Math.max(0, ...activeReservations.map((reservation) => slotNumber(reservation.slot_id)));
      const visibleSlotCount = Math.max(window.capacity, highestActiveSlot);
      const slotRows = slots().filter((slot) => slotNumber(slot.slot_id) <= visibleSlotCount).map((slot) => {
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
        minimumCapacity: Math.max(1, highestActiveSlot),
        slotRows
      };
    })
  );

  const adminOrderGroups = createMemo(() => {
    const groups = [
      { id: "pending", label: "Chưa xử lý", orders: [] as Order[] },
      { id: "working", label: "Đang chuẩn bị", orders: [] as Order[] },
      { id: "ready", label: "Sẵn sàng nhận", orders: [] as Order[] },
      { id: "done", label: "Hoàn tất", orders: [] as Order[] },
      { id: "attention", label: "Cần kiểm tra", orders: [] as Order[] }
    ];

    for (const order of orders()) {
      const boardItem = board().find((item) => item.order_id === order.order_id);
      const status = boardItem?.status ?? order.order_status;
      if (status === "SlotAssigned" || status === "Paid") groups[0].orders.push(order);
      else if (status === "Preparing" || status === "PlacedInSlot") groups[1].orders.push(order);
      else if (status === "ReadyForPickup" || status === "Ready") groups[2].orders.push(order);
      else if (status === "Completed") groups[3].orders.push(order);
      else groups[4].orders.push(order);
    }

    return groups.filter((group) => group.orders.length > 0);
  });

  const syncRoute = () => setActiveView(routeFromPath(window.location.pathname));

  onMount(async () => {
    window.addEventListener("popstate", syncRoute);
    try {
      await loadProducts();
      await refreshOperationalData();
      syncAdminOrderBaseline();
    } finally {
      setInitialLoading(false);
    }
  });

  onCleanup(() => {
    window.removeEventListener("popstate", syncRoute);
    if (adminToastTimer) window.clearTimeout(adminToastTimer);
  });

  createEffect(() => {
    const currentSelection = selectedOrderId();
    if (currentSelection && orders().some((order) => order.order_id === currentSelection)) return;
    setSelectedOrderId(board()[0]?.order_id ?? orders()[0]?.order_id ?? "");
  });

  createEffect(() => {
    const trackedOrders = customerOrders();
    const currentOrderId = customerOrderId();
    if (currentOrderId && trackedOrders.some((order) => order.order_id === currentOrderId)) return;
    const nextOrderId = trackedOrders[0]?.order_id ?? "";
    setCustomerOrderId(nextOrderId);
    if (nextOrderId) window.localStorage.setItem(LAST_CUSTOMER_ORDER_KEY, nextOrderId);
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

  createEffect(() => {
    if (activeView() !== "customer" || customerOrderIds().length === 0) return;

    let refreshInFlight = false;
    const timer = window.setInterval(async () => {
      if (refreshInFlight || busy() || document.visibilityState === "hidden") return;
      refreshInFlight = true;
      setAutoRefreshing(true);
      try {
        await refreshCustomerData();
      } finally {
        setAutoRefreshing(false);
        refreshInFlight = false;
      }
    }, CUSTOMER_STATUS_SYNC_MS);

    onCleanup(() => window.clearInterval(timer));
  });

  createEffect(() => {
    if (activeView() !== "admin" || initialLoading()) return;

    let refreshInFlight = false;
    const timer = window.setInterval(async () => {
      if (refreshInFlight || busy() || document.visibilityState === "hidden") return;
      refreshInFlight = true;
      try {
        await refreshAdminData();
      } finally {
        refreshInFlight = false;
      }
    }, ADMIN_STATUS_SYNC_MS);

    onCleanup(() => window.clearInterval(timer));
  });

  async function runAction(label: string, action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setNotice(label);
    } catch (err) {
      setError(err instanceof Error ? translateError(err.message) : "Yêu cầu thất bại");
    } finally {
      setBusy(false);
    }
  }

  async function loadProducts() {
    const loaded = await loadResource("Danh mục", peakpickApi.listProducts, setProducts);
    if (loaded) setNotice("Đã tải danh mục");
  }

  async function refreshOperationalData() {
    await Promise.all([
      loadResource("Đơn hàng", peakpickApi.listOrders, setOrders),
      loadResource("Bảng xử lý đơn", peakpickApi.getStaffBoard, setBoard),
      loadResource("Lịch giữ ô nhận", peakpickApi.getSlotReservations, setReservations),
      loadResource("Khung giờ nhận hàng", peakpickApi.getPickupWindows, setPickupWindowMeta),
      loadResource("Ô nhận", peakpickApi.getSlots, setSlots),
      loadResource("Nhật ký thông báo", peakpickApi.getNotifications, setNotifications),
      loadResource("Thống kê hệ thống", peakpickApi.getAnalytics, setAnalytics)
    ]);
  }

  async function refreshAdminData(options: { announceNewOrders?: boolean } = {}) {
    const shouldAnnounce = options.announceNewOrders ?? true;
    const previousOrderIds = new Set(seenAdminOrderIds());

    await refreshOperationalData();

    const currentOrders = orders();
    const newOrders = currentOrders.filter((order) => !previousOrderIds.has(order.order_id));
    if (shouldAnnounce && adminOrderBaselineReady() && newOrders.length > 0) {
      showAdminOrderToast(newOrders);
    }
    syncAdminOrderBaseline();
  }

  async function refreshCustomerData() {
    await Promise.all([
      loadResource("Đơn hàng", peakpickApi.listOrders, setOrders),
      loadResource("Bảng xử lý đơn", peakpickApi.getStaffBoard, setBoard),
      loadResource("Lịch giữ ô nhận", peakpickApi.getSlotReservations, setReservations),
      loadResource("Khung giờ nhận hàng", peakpickApi.getPickupWindows, setPickupWindowMeta),
      loadResource("Ô nhận", peakpickApi.getSlots, setSlots)
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
        [key]: err instanceof Error ? translateError(err.message) : "Yêu cầu thất bại"
      }));
      return false;
    }
  }

  async function submitCheckout() {
    await runAction("Đã phát sự kiện đơn đã thanh toán", async () => {
      const response = await peakpickApi.checkout({
        customer_name: customerName(),
        pickup_window: pickupWindow(),
        items: selectedItems()
      });
      setCheckout(response);
      selectCustomerOrder(response.order.order_id);
      addCustomerOrderId(response.order.order_id);
      setSelectedOrderId(response.order.order_id);
      setPickupToken("");
      await new Promise((resolve) => setTimeout(resolve, 600));
      await refreshOperationalData();
    });
  }

  async function markPreparing() {
    const item = selectedBoardItem();
    if (!item) return;
    await runAction("Đã chuyển đơn sang đang chuẩn bị", async () => {
      const updated = await peakpickApi.markPreparing(item.order_id);
      applyBoardUpdate(updated);
      queueAdminRefresh();
    });
  }

  async function markReady() {
    const item = selectedBoardItem();
    if (!item) return;
    await runAction("Đã chuyển đơn sang sẵn sàng nhận", async () => {
      const updated = await peakpickApi.markReady(item.order_id);
      applyBoardUpdate(updated);
      queueAdminRefresh();
    });
  }

  async function verifyPickup() {
    const item = selectedBoardItem();
    const token = pickupToken().trim() || item?.token;
    if (!item || !token) return;
    await runAction("Đã xác nhận khách đã nhận hàng", async () => {
      const updated = await peakpickApi.verifyPickup(item.order_id, token);
      applyBoardUpdate(updated);
      queueAdminRefresh();
    });
  }

  async function updatePickupWindowCapacity(pickupWindow: string, minimumCapacity: number) {
    const rawCapacity = capacityDrafts()[pickupWindow] ?? "";
    const capacity = Number(rawCapacity);
    if (!Number.isInteger(capacity) || capacity < minimumCapacity) {
      setError(`Số ô phải từ ${minimumCapacity} trở lên`);
      return;
    }

    await runAction("Đã cập nhật số lượng ô nhận", async () => {
      const updated = await peakpickApi.updatePickupWindowCapacity(pickupWindow, capacity);
      setPickupWindowMeta((current) => {
        const exists = current.some((item) => item.pickup_window === updated.pickup_window);
        if (!exists) return [...current, updated];
        return current.map((item) => (item.pickup_window === updated.pickup_window ? updated : item));
      });
      setCapacityDrafts((current) => {
        const next = { ...current };
        delete next[pickupWindow];
        return next;
      });
      await refreshAdminData({ announceNewOrders: false });
    });
  }

  function updateQuantity(sku: string, value: number) {
    setQuantities((current) => ({ ...current, [sku]: Math.max(0, value) }));
  }

  function selectCustomerOrder(orderId: string) {
    setCustomerOrderId(orderId);
    window.localStorage.setItem(LAST_CUSTOMER_ORDER_KEY, orderId);
  }

  function addCustomerOrderId(orderId: string) {
    setCustomerOrderIds((current) => {
      const next = [orderId, ...current.filter((id) => id !== orderId)].slice(0, 8);
      window.localStorage.setItem(CUSTOMER_ORDER_IDS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function replaceBoardItem(updated: StaffBoardItem) {
    setBoard((current) => {
      const exists = current.some((item) => item.order_id === updated.order_id);
      if (!exists) return [updated, ...current];
      return current.map((item) => (item.order_id === updated.order_id ? updated : item));
    });
  }

  function applyBoardUpdate(updated: StaffBoardItem) {
    replaceBoardItem(updated);
    setSelectedOrderId(updated.order_id);
    setPickupToken(updated.token ?? "");
  }

  function queueAdminRefresh() {
    window.setTimeout(() => void refreshAdminData({ announceNewOrders: false }), 350);
  }

  function syncAdminOrderBaseline() {
    setSeenAdminOrderIds(orders().map((order) => order.order_id));
    setAdminOrderBaselineReady(true);
  }

  function showAdminOrderToast(newOrders: Order[]) {
    const newestOrder = newOrders[newOrders.length - 1];
    if (!newestOrder) return;
    if (adminToastTimer) window.clearTimeout(adminToastTimer);
    setAdminToast({
      title: newOrders.length > 1 ? `${newOrders.length} đơn mới` : "Có đơn mới",
      body: `${newestOrder.customer_name} · ${newestOrder.pickup_window} · ${shortId(newestOrder.order_id)}`,
      orderId: newestOrder.order_id
    });
    adminToastTimer = window.setTimeout(() => setAdminToast(null), 5200);
  }

  function capacityDraftValue(pickupWindow: string, capacity: number) {
    return capacityDrafts()[pickupWindow] ?? String(capacity);
  }

  function setCapacityDraft(pickupWindow: string, value: string) {
    setCapacityDrafts((current) => ({ ...current, [pickupWindow]: value }));
  }

  async function copyOrderId() {
    const orderId = customerOrder()?.order_id;
    if (!orderId) return;
    await navigator.clipboard.writeText(orderId);
    setNotice("Đã sao chép mã đơn");
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
        <div class="topbar-actions">
          <div class="status-strip">
            <span class="status-dot" />
            <span>{notice()}</span>
          </div>
          <a
            class="role-switch"
            href={roleSwitchLink().path}
            onClick={(event) => {
              event.preventDefault();
              navigateToRoute(roleSwitchLink().id, roleSwitchLink().path);
            }}
          >
            Mở trang {roleSwitchLink().label}
          </a>
        </div>
      </header>

      <Show when={activeView() === "admin" && adminToast()}>
        {(toast) => (
          <button
            class="admin-toast"
            type="button"
            onClick={() => {
              setActiveAdminTab("detail");
              setSelectedOrderId(toast().orderId);
              setAdminToast(null);
            }}
          >
            <Bell size={17} />
            <span>
              <strong>{toast().title}</strong>
              <small>{toast().body}</small>
            </span>
          </button>
        )}
      </Show>

      <Show when={activeView() === "admin"}>
        <nav class="section-nav" aria-label="Các mục quản trị">
          <For each={adminTabs}>
            {(item) => (
              <button
                class={activeAdminTab() === item.id ? "active" : ""}
                type="button"
                onClick={() => setActiveAdminTab(item.id)}
              >
                {item.label}
              </button>
            )}
          </For>
        </nav>
      </Show>

      <Show when={error()}>
        <div class="alert" role="alert">
          {error()}
        </div>
      </Show>

      <Show when={Object.keys(dataErrors()).length > 0}>
        <div class="module-alert" role="status">
          <strong>Một số dịch vụ đang không khả dụng.</strong>
          <span>{Object.keys(dataErrors()).join(", ")}</span>
        </div>
      </Show>

      <section class={`customer-grid view-section ${activeView() === "customer" ? "active" : ""}`}>
        <section class="panel order-panel" id="checkout">
          <div class="panel-heading">
            <ShoppingCart size={19} />
            <h2>Chọn hàng và thanh toán</h2>
          </div>

          <label>
            Khách hàng
            <input value={customerName()} onInput={(event) => setCustomerName(event.currentTarget.value)} />
          </label>

          <label>
            Khung giờ nhận
            <select value={pickupWindow()} onChange={(event) => setPickupWindow(event.currentTarget.value)}>
              <For each={pickupWindowOptions()}>
                {(window) => (
                  <option value={window.pickup_window} disabled={window.available <= 0}>
                    {window.pickup_window} - trống {window.available} ô
                  </option>
                )}
              </For>
            </select>
          </label>

          <div class="product-list">
            <Show
              when={!initialLoading() && products().length > 0}
              fallback={<p class="empty-state">{initialLoading() ? "Đang tải sản phẩm..." : "Chưa có sản phẩm khả dụng."}</p>}
            >
              <For each={products()}>
                {(product) => (
                  <div class="product-row">
                    <div>
                      <strong>{productName(product)}</strong>
                      <span>{formatCurrency(product.price)}</span>
                    </div>
                    <input
                      type="number"
                      min="0"
                      value={quantities()[product.sku] ?? 0}
                      onInput={(event) => updateQuantity(product.sku, Number(event.currentTarget.value))}
                      aria-label={`Số lượng ${productName(product)}`}
                    />
                  </div>
                )}
              </For>
            </Show>
          </div>

          <div class="summary-line">
            <span>Tổng cộng</span>
            <strong>{formatCurrency(total())}</strong>
          </div>

          <button class="primary-action" disabled={busy() || !hasCheckoutInput()} onClick={submitCheckout}>
            <CreditCard size={18} />
            Tạo đơn đã thanh toán
          </button>
          <Show when={!hasCheckoutInput()}>
            <p class="helper-text">
              Nhập tên khách, chọn ít nhất một món, và chọn khung giờ còn ô trống.
            </p>
          </Show>

          <Show when={customerOrder()}>
            {(order) => (
              <div class="receipt success">
                <span>{checkout() ? "Đã tạo đơn thanh toán" : "Đang theo dõi đơn được chọn"}</span>
                <button class="ghost-action" onClick={copyOrderId} title="Sao chép mã đơn">
                  <Copy size={16} />
                  {shortId(order().order_id)}
                </button>
              </div>
            )}
          </Show>
        </section>

        <section class="panel customer-status-panel" id="pickup-status">
          <div class="panel-heading">
            <ClipboardList size={19} />
            <h2>Trạng thái nhận hàng</h2>
          </div>

          <Show when={customerOrders().length > 0} fallback={<p class="empty-state">Hãy đặt đơn để theo dõi trạng thái nhận hàng.</p>}>
            <div class="order-list">
              <div class="subsection-heading">
                <h3>Đơn đang theo dõi</h3>
                <span>{customerOrders().length} đơn</span>
              </div>
              <For each={customerOrders()}>
                {(order) => {
                  const boardItem = board().find((item) => item.order_id === order.order_id);
                  return (
                    <button
                      class={`order-list-item ${customerOrderId() === order.order_id ? "selected" : ""}`}
                      type="button"
                      onClick={() => selectCustomerOrder(order.order_id)}
                    >
                      <div>
                        <strong>{shortId(order.order_id)}</strong>
                        <span>{order.pickup_window}</span>
                      </div>
                      <StatusBadge value={boardItem?.status ?? order.order_status} />
                    </button>
                  );
                }}
              </For>
            </div>
          </Show>

          <Show when={customerOrder()}>
            {(order) => (
              <>
                <div class="live-sync" aria-live="polite">
                  <RefreshCw class={autoRefreshing() ? "spin" : ""} size={15} />
                  <span>{autoRefreshing() ? "Đang cập nhật trạng thái..." : "Tự cập nhật trạng thái mỗi 3 giây"}</span>
                </div>

                <div class="pickup-card">
                  <div>
                    <span>Ô nhận hàng</span>
                    <strong>{pickupSlotLabel(order().order_status, customerBoardItem())}</strong>
                  </div>
                  <StatusBadge value={customerBoardItem()?.status ?? order().order_status} />
                </div>

                <div class="detail-grid">
                  <Detail label="Mã đơn" value={order().order_id} />
                  <Detail label="Khung giờ" value={order().pickup_window} />
                  <Detail label="Ô được gán" value={pickupSlotLabel(order().order_status, customerBoardItem())} />
                  <Detail label="Trạng thái hiện tại" value={statusLabel(customerBoardItem()?.status ?? order().order_status)} />
                  <Detail label="Thanh toán" value={statusLabel(order().payment_status)} />
                  <Detail label="Mã nhận hàng" value={customerBoardItem()?.token ?? "Chưa sẵn sàng"} />
                </div>

                <Show when={order().order_status === "SlotAssignmentFailed"}>
                  <p class="empty-state">Khung giờ này đã hết ô nhận hàng. Hãy tạo đơn mới với khung giờ khác.</p>
                </Show>

                <div class="timeline">
                  <For each={orderSteps}>
                    {(step) => (
                      <div
                        class={`timeline-step ${isStepReached(customerBoardItem()?.status ?? order().order_status, step) ? "active" : ""}`}
                      >
                        <span />
                        <p>{statusLabel(step)}</p>
                      </div>
                    )}
                  </For>
                </div>

                <Show when={customerBoardItem()?.token}>
                  {(token) => (
                <div class="token-card">
                      <div>
                        <span>Mã QR nhận hàng</span>
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
        <Show when={activeAdminTab() === "evidence"}>
          <section class="panel insight-panel" id="system-evidence">
          <div class="panel-heading">
            <BarChart3 size={19} />
            <h2>Theo dõi hệ thống</h2>
          </div>

          <div class="metric-grid">
            <Metric label="Đơn đã thanh toán" value={analytics().counts.OrderPaid ?? 0} />
            <Metric label="Ô nhận đã đặt" value={analytics().counts.PickupSlotReserved ?? 0} />
            <Metric label="Đơn sẵn sàng" value={analytics().counts.OrderReady ?? 0} />
            <Metric label="Đã nhận" value={analytics().counts.OrderPickedUp ?? 0} />
          </div>

          <div class="feed">
            <h3>Thông báo gửi khách</h3>
            <Show when={notifications().length > 0} fallback={<p class="empty-state">Chưa có thông báo gửi khách.</p>}>
              <For each={notifications().slice(-3).reverse()}>
                {(notification) => (
                  <div class="feed-row">
                    <Bell size={16} />
                    <span>{notificationMessage(notification.message)}</span>
                  </div>
                )}
              </For>
            </Show>
          </div>
          </section>
        </Show>

        <Show when={activeAdminTab() === "detail"}>
          <section class="panel order-detail-panel" id="order-detail">
          <div class="panel-heading split">
            <div>
              <ClipboardList size={19} />
              <h2>Đơn hàng</h2>
            </div>
            <button class="icon-action" onClick={() => runAction("Đã làm mới dữ liệu vận hành", refreshAdminData)} title="Làm mới">
              <RefreshCw size={17} />
            </button>
          </div>

          <div class="order-master-detail">
            <Show when={orders().length > 0} fallback={<p class="empty-state">Chưa có đơn hàng nào.</p>}>
              <div class="order-list scroll-list">
                <div class="subsection-heading">
                  <h3>Danh sách đơn</h3>
                  <span>{orders().length} đơn</span>
                </div>
                <For each={adminOrderGroups()}>
                  {(group) => (
                    <div class="order-group">
                      <div class="order-group-heading">
                        <span>{group.label}</span>
                        <small>{group.orders.length}</small>
                      </div>
                      <For each={group.orders}>
                        {(order) => {
                          const boardItem = board().find((item) => item.order_id === order.order_id);
                          return (
                            <button
                              class={`order-list-item ${selectedOrderId() === order.order_id ? "selected" : ""}`}
                              type="button"
                              onClick={() => setSelectedOrderId(order.order_id)}
                            >
                              <div>
                                <strong>{shortId(order.order_id)}</strong>
                                <span>{order.customer_name} · {order.pickup_window}</span>
                              </div>
                              <StatusBadge value={boardItem?.status ?? order.order_status} />
                            </button>
                          );
                        }}
                      </For>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <div class="order-detail-surface">
              <Show when={selectedOrder()} fallback={<p class="empty-state">Chọn một đơn trong danh sách để xem chi tiết.</p>}>
                {(order) => (
                  <>
                    <div class="subsection-heading">
                      <h3>Chi tiết đơn</h3>
                      <StatusBadge value={selectedOrderBoardItem()?.status ?? order().order_status} />
                    </div>

                    <div class="detail-grid">
                      <Detail label="Mã đơn" value={order().order_id} />
                      <Detail label="Khách hàng" value={order().customer_name} />
                      <Detail label="Thanh toán" value={statusLabel(order().payment_status)} />
                      <Detail label="Khung giờ" value={order().pickup_window} />
                      <Detail label="Ô nhận" value={pickupSlotLabel(order().order_status, selectedOrderBoardItem())} />
                      <Detail label="Mã nhận hàng" value={selectedOrderBoardItem()?.token ?? "Chưa sẵn sàng"} />
                    </div>

                    <div class="timeline">
                      <For each={orderSteps}>
                        {(step) => (
                          <div
                            class={`timeline-step ${isStepReached(selectedOrderBoardItem()?.status ?? order().order_status, step) ? "active" : ""}`}
                          >
                            <span />
                            <p>{statusLabel(step)}</p>
                          </div>
                        )}
                      </For>
                    </div>

                    <div class="item-stack">
                      <For each={order().items}>
                        {(item) => (
                          <div class="compact-row">
                            <span>{productNameBySku(item.sku)}</span>
                            <strong>x{item.quantity}</strong>
                          </div>
                        )}
                      </For>
                    </div>

                    <div class="staff-action-panel">
                      <div class="subsection-heading">
                        <h3>Thao tác xử lý</h3>
                        <span>{selectedOrderBoardItem()?.slot_id ?? "Chưa vào hàng chờ"}</span>
                      </div>

                      <div class="readonly-token">
                        <span>Mã nhận hàng</span>
                        <strong>{selectedOrderBoardItem()?.token ?? "Chưa sẵn sàng"}</strong>
                      </div>

                      <Show when={nextOrderAction()} fallback={<p class="empty-state compact">Không có thao tác tiếp theo.</p>}>
                        {(nextAction) => {
                          const Icon = nextAction().icon;
                          return (
                            <button
                              class="primary-action confirm"
                              disabled={nextAction().disabled}
                              onClick={() => void nextAction().action()}
                            >
                              <Icon size={18} />
                              {nextAction().label}
                            </button>
                          );
                        }}
                      </Show>

                      <p class="helper-text">{actionHint()}</p>
                    </div>
                  </>
                )}
              </Show>
            </div>
          </div>
          </section>
        </Show>

        <Show when={activeAdminTab() === "capacity"}>
          <section class="panel slot-dashboard-panel" id="slot-capacity">
          <div class="panel-heading">
            <Layers3 size={19} />
            <h2>Công suất ô nhận theo khung giờ</h2>
          </div>

          <For each={slotDashboardRows()}>
            {(window) => (
              <div class="window-capacity">
                <div class="window-title">
                  <h3>{window.pickup_window}</h3>
                  <span>Đã dùng {window.used}/{window.capacity}</span>
                </div>
                <form
                  class="capacity-editor"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void updatePickupWindowCapacity(window.pickup_window, window.minimumCapacity);
                  }}
                >
                  <label>
                    Số ô nhận
                    <input
                      type="number"
                      min={window.minimumCapacity}
                      max="99"
                      value={capacityDraftValue(window.pickup_window, window.capacity)}
                      onInput={(event) => setCapacityDraft(window.pickup_window, event.currentTarget.value)}
                    />
                  </label>
                  <button class="ghost-action" type="submit" disabled={busy()}>
                    Cập nhật
                  </button>
                </form>
                <Show when={window.minimumCapacity > 1}>
                  <p class="helper-text">
                    Tối thiểu {window.minimumCapacity} vì đang có đơn trong ô nhận hiện tại.
                  </p>
                </Show>
                <div class="capacity-strip">
                  <Metric label="Tổng ô" value={window.capacity} />
                  <Metric label="Đã đặt" value={window.used} />
                  <Metric label="Ô trống" value={window.available} />
                </div>
                <div class="slot-grid">
                  <For each={window.slotRows}>
                    {(slot) => (
                      <div class={`slot-tile ${slot.status.toLowerCase()}`}>
                        <strong>{slot.slot_id}</strong>
                  <span>{statusLabel(slot.status)}</span>
                        <Show when={slot.order_id}>{(orderId) => <small>{shortId(orderId())}</small>}</Show>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
          </section>
        </Show>

        <Show when={activeAdminTab() === "reservations"}>
          <section class="panel reservation-panel" id="reservations">
          <div class="panel-heading">
            <CalendarClock size={19} />
            <h2>Lịch giữ ô nhận</h2>
          </div>

          <Show when={reservations().length > 0} fallback={<p class="empty-state">Chưa có ô nhận nào được giữ.</p>}>
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
        </Show>

        <Show when={activeAdminTab() === "events"}>
          <section class="panel event-log-panel" id="event-log">
          <div class="panel-heading">
            <Activity size={19} />
            <h2>Nhật ký sự kiện</h2>
          </div>

          <Show when={analytics().recent_events.length > 0} fallback={<p class="empty-state">Chưa có sự kiện mới.</p>}>
            <div class="event-list">
              <For each={analytics().recent_events.slice(-8).reverse()}>
                {(event) => {
                  const order = orders().find((item) => item.order_id === event.aggregate_id);
                  const boardItem = board().find((item) => item.order_id === event.aggregate_id);
                  return (
                    <div class="event-row rich-event-row">
                      <div>
                        <strong>{eventTypeLabel(event.event_type)}</strong>
                        <span>{order ? `${order.customer_name} · ${order.pickup_window}` : "Chưa khớp với đơn hàng"}</span>
                      </div>
                      <span>{shortId(event.aggregate_id)}</span>
                      <Show when={order}>
                        <StatusBadge value={boardItem?.status ?? order?.order_status ?? "Paid"} />
                      </Show>
                      <small>{sourceLabel(event.source)}</small>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
          </section>
        </Show>
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
  return <span class={`status-badge ${props.value.toLowerCase()}`}>{statusLabel(props.value)}</span>;
}

function pickupSlotLabel(orderStatus: string, boardItem: StaffBoardItem | null) {
  if (boardItem?.slot_id) return boardItem.slot_id;
  if (orderStatus === "SlotAssignmentFailed") return "Không còn ô";
  return "Đang gán";
}

function PickupCode(props: { token: string }) {
  const cells = createMemo(() => pickupCodeCells(props.token));
  return (
    <div class="pickup-code" aria-label={`Mã QR nhận hàng cho ${props.token}`}>
      <For each={cells()}>
        {(filled) => <span class={filled ? "filled" : ""} />}
      </For>
    </div>
  );
}

function productName(product: Product) {
  return productNameBySku(product.sku) ?? product.name;
}

function productNameBySku(sku: string) {
  const names: Record<string, string> = {
    coffee: "Cà phê đá",
    water: "Nước suối",
    tea: "Trà đào",
    sandwich: "Bánh mì gà",
    snack: "Snack rong biển"
  };
  return names[sku] ?? sku;
}

function readCustomerOrderIds() {
  const lastOrderId = window.localStorage.getItem(LAST_CUSTOMER_ORDER_KEY);
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CUSTOMER_ORDER_IDS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return lastOrderId ? [lastOrderId] : [];
    const ids = parsed.filter((value): value is string => typeof value === "string");
    return lastOrderId && !ids.includes(lastOrderId) ? [lastOrderId, ...ids] : ids;
  } catch {
    return lastOrderId ? [lastOrderId] : [];
  }
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    Available: "Ô trống",
    CartCreated: "Đã tạo giỏ",
    Completed: "Hoàn tất",
    Expired: "Hết hạn",
    InventoryShortage: "Thiếu hàng",
    Paid: "Đã thanh toán",
    PaymentPending: "Chờ thanh toán",
    PlacedInSlot: "Đã đặt vào ô",
    Preparing: "Đang chuẩn bị",
    Ready: "Sẵn sàng nhận",
    ReadyForPickup: "Sẵn sàng nhận",
    RefundRequested: "Yêu cầu hoàn tiền",
    Reserved: "Đã giữ ô",
    SlotAssigned: "Đã gán ô",
    SlotAssignmentFailed: "Không còn ô"
  };
  return labels[value] ?? value;
}

function eventTypeLabel(value: string) {
  const labels: Record<string, string> = {
    AnalyticsUpdated: "Đã cập nhật phân tích",
    CartCreated: "Đã tạo giỏ",
    InventoryReserved: "Đã giữ tồn kho",
    InventoryShortageDetected: "Phát hiện thiếu hàng",
    NotificationRequested: "Đã yêu cầu thông báo",
    OrderExpired: "Đơn hết hạn",
    OrderPaid: "Đơn đã thanh toán",
    OrderPickedUp: "Khách đã nhận hàng",
    OrderPlacedInSlot: "Đơn đã đặt vào ô",
    OrderPreparing: "Đơn đang chuẩn bị",
    OrderReady: "Đơn sẵn sàng nhận",
    PickupSlotFull: "Hết ô nhận trong khung giờ",
    PickupSlotReserved: "Đã giữ ô nhận"
  };
  return labels[value] ?? value;
}

function sourceLabel(value: string) {
  const labels: Record<string, string> = {
    "analytics-service": "Dịch vụ phân tích",
    "inventory-service": "Dịch vụ tồn kho",
    "notification-service": "Dịch vụ thông báo",
    "order-service": "Dịch vụ đơn hàng",
    "slot-service": "Dịch vụ quản lý ô nhận",
    "store-ops-service": "Dịch vụ vận hành cửa hàng"
  };
  return labels[value] ?? value;
}

function notificationMessage(message: string) {
  const readyMatch = message.match(/^Order (.+) is ready at slot (.+)\. Token: (.+)$/);
  if (readyMatch) {
    return `Đơn ${readyMatch[1]} đã sẵn sàng tại ô ${readyMatch[2]}. Mã nhận hàng: ${readyMatch[3]}`;
  }
  return message;
}

function translateError(message: string) {
  if (message.includes("Invalid pickup token")) return "Mã nhận hàng không hợp lệ";
  if (message.includes("Order is not on the staff board")) return "Đơn chưa xuất hiện trên bảng nhân viên";
  if (message.includes("Capacity must be at least")) return "Không thể giảm số ô thấp hơn ô đang có đơn";
  if (message.includes("Request failed")) return "Yêu cầu thất bại";
  return message;
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

function slotNumber(slotId: string) {
  const parsed = Number(slotId.replace("P-", ""));
  return Number.isFinite(parsed) ? parsed : 0;
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
