import type {
  AnalyticsSnapshot,
  CheckoutRequest,
  CheckoutResponse,
  NotificationLog,
  Product,
  SlotReservation,
  StaffBoardItem
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
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

  listProducts(): Promise<Product[]> {
    return requestJson<Product[]>("/catalog/products");
  },

  checkout(payload: CheckoutRequest): Promise<CheckoutResponse> {
    return requestJson<CheckoutResponse>("/orders/checkout", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  getStaffBoard(): Promise<StaffBoardItem[]> {
    return requestJson<StaffBoardItem[]>("/store/board");
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

  getNotifications(): Promise<NotificationLog[]> {
    return requestJson<NotificationLog[]>("/notifications/notifications");
  },

  getAnalytics(): Promise<AnalyticsSnapshot> {
    return requestJson<AnalyticsSnapshot>("/analytics/events");
  }
};

