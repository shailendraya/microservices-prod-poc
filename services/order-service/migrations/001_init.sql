CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id BIGINT NOT NULL,

    idempotency_key VARCHAR(100) NOT NULL UNIQUE,

    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',

    total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,

    currency CHAR(3) NOT NULL DEFAULT 'INR',

    inventory_reservation_id UUID,

    failure_reason TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_order_status CHECK (
        status IN ('PENDING', 'CONFIRMED', 'FAILED')
    ),

    CONSTRAINT valid_order_amount CHECK (
        total_amount >= 0
    )
);

CREATE TABLE IF NOT EXISTS order_items (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

    sku VARCHAR(50) NOT NULL,

    product_name VARCHAR(150) NOT NULL,

    unit_price NUMERIC(12, 2) NOT NULL,

    currency CHAR(3) NOT NULL DEFAULT 'INR',

    quantity INTEGER NOT NULL CHECK (quantity > 0),

    line_total NUMERIC(14, 2) NOT NULL,

    CONSTRAINT valid_item_price CHECK (
        unit_price >= 0 AND line_total >= 0
    ),

    CONSTRAINT unique_order_sku UNIQUE (order_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id
ON orders(user_id);

CREATE INDEX IF NOT EXISTS idx_orders_status_created_at
ON orders(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_items_sku
ON order_items(sku);
