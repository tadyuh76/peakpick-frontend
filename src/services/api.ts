import type {
  AnalyticsSnapshot,
  AuthUser,
  CheckoutRequest,
  CheckoutResponse,
  LoginResponse,
  Order,
  NotificationLog,
  OperationsSummary,
  PickupSlot,
  PickupWindow,
  Product,
  SlotReservation,
  StockItem,
  StaffBoardItem
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
export const AUTH_TOKEN_KEY = "peakpick:auth-token";
export const AUTH_USER_KEY = "peakpick:auth-user";

function authHeaders(): Record<string, string> {
  const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...options.headers
    },
    ...options
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const peakpickApi = {
  apiBaseUrl: API_BASE_URL,

  login(username: string, password: string): Promise<LoginResponse> {
    return requestJson<LoginResponse>("/identity/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
  },

  me(): Promise<AuthUser> {
    return requestJson<AuthUser>("/identity/auth/me");
  },

  listProducts(): Promise<Product[]> {
    return requestJson<Product[]>("/catalog/products");
  },

  checkout(payload: CheckoutRequest): Promise<CheckoutResponse> {
    return requestJson<CheckoutResponse>("/orders/checkout", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  listOrders(): Promise<Order[]> {
    return requestJson<Order[]>("/orders/orders");
  },

  getStaffBoard(status?: string): Promise<StaffBoardItem[]> {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return requestJson<StaffBoardItem[]>(`/store/board${query}`);
  },

  markPreparing(orderId: string): Promise<StaffBoardItem> {
    return requestJson<StaffBoardItem>(`/store/orders/${orderId}/preparing`, {
      method: "POST"
    });
  },

  markReady(orderId: string): Promise<StaffBoardItem> {
    return requestJson<StaffBoardItem>(`/store/orders/${orderId}/ready`, {
      method: "POST"
    });
  },

  verifyPickup(orderId: string, token: string): Promise<StaffBoardItem> {
    return requestJson<StaffBoardItem>(`/store/orders/${orderId}/pickup`, {
      method: "POST",
      body: JSON.stringify({ token })
    });
  },

  getSlotReservations(): Promise<SlotReservation[]> {
    return requestJson<SlotReservation[]>("/slots/reservations");
  },

  getStock(): Promise<Record<string, number>> {
    return requestJson<Record<string, number>>("/inventory/stock");
  },

  getLowStock(threshold = 30): Promise<StockItem[]> {
    return requestJson<StockItem[]>(`/inventory/stock/low?threshold=${threshold}`);
  },

  getPickupWindows(): Promise<PickupWindow[]> {
    return requestJson<PickupWindow[]>("/slots/pickup-windows");
  },

  updatePickupWindowCapacity(pickupWindow: string, capacity: number): Promise<PickupWindow> {
    return requestJson<PickupWindow>(`/slots/pickup-windows/${encodeURIComponent(pickupWindow)}`, {
      method: "PATCH",
      body: JSON.stringify({ capacity })
    });
  },

  getSlots(): Promise<PickupSlot[]> {
    return requestJson<PickupSlot[]>("/slots/slots");
  },

  getNotifications(): Promise<NotificationLog[]> {
    return requestJson<NotificationLog[]>("/notifications/notifications");
  },

  getAnalytics(): Promise<AnalyticsSnapshot> {
    return requestJson<AnalyticsSnapshot>("/analytics/events");
  },

  getOperationsSummary(): Promise<OperationsSummary> {
    return requestJson<OperationsSummary>("/analytics/operations/summary");
  }
};
