export interface Product {
  sku: string;
  name: string;
  category: string;
  price: number;
  available: boolean;
  prep_time_minutes: number;
  display_order: number;
}

export interface OrderItem {
  sku: string;
  quantity: number;
}

export interface CheckoutRequest {
  customer_name: string;
  pickup_window: string;
  items: OrderItem[];
}

export interface Order {
  order_id: string;
  customer_name: string;
  items: OrderItem[];
  pickup_window: string;
  payment_status: string;
  order_status: string;
  paid_at: string;
}

export interface CheckoutResponse {
  order: Order;
  correlation_id: string;
}

export interface StaffBoardItem {
  order_id: string;
  slot_id: string;
  pickup_window: string;
  status: string;
  token: string | null;
  correlation_id: string;
  updated_at: string;
  verified_at?: string;
  picked_up_at?: string;
}

export interface PickupWindow {
  pickup_window: string;
  capacity: number;
  active: boolean;
}

export interface PickupSlot {
  slot_id: string;
  active: boolean;
}

export interface SlotReservation {
  order_id: string;
  slot_id: string;
  pickup_window: string;
  status: string;
  reserved_at?: string;
  released_at?: string;
}

export interface NotificationLog {
  order_id: string;
  message: string;
  channel: string;
  status: string;
  sent_at: string;
}

export interface StockItem {
  sku: string;
  quantity: number;
}

export interface OperationsSummary {
  orders_paid: number;
  orders_ready: number;
  orders_picked_up: number;
  inventory_reservations: number;
  inventory_shortages: number;
  notifications_requested: number;
  pickup_completion_rate: number;
}

export interface AnalyticsSnapshot {
  counts: Record<string, number>;
  recent_events: Array<{
    event_type: string;
    aggregate_id: string;
    correlation_id: string;
    source: string;
  }>;
}
