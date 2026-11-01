CREATE VIEW order_lines AS
SELECT o.id AS order_id, o.ordered_at, o.status, c.name AS customer, c.country,
       p.name AS product, p.category, o.quantity, p.price, o.quantity * p.price AS amount
FROM orders o
JOIN customers c ON c.id = o.customer_id
JOIN products p ON p.id = o.product_id;

CREATE MATERIALIZED VIEW monthly_revenue AS
SELECT substr(ordered_at, 1, 7) AS month, count(*) AS orders, round(sum(quantity * price), 2) AS revenue
FROM orders JOIN products ON products.id = orders.product_id
WHERE status <> 'cancelled'
GROUP BY 1;
