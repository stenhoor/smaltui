---
description: 'Run SQL, TypeScript (smaltdf) and Cypher (smaltcy) on this page, in your browser, on the same engine the workbench runs.'
play:
  dataset: social
---

# Playground

Each example runs here, in your browser, on the engine and languages the workbench uses. Edit one and press **Run**.
**Open in smaltui** opens a SQL example in a query tab of the workbench.

## SQL

```sql
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 10)
SELECT i, i * i AS square, sum(i) OVER (ORDER BY i) AS running_total FROM n;
```

| i | square | running_total |
| --- | --- | --- |
| 1 | 1 | 1 |
| 2 | 4 | 3 |
| 3 | 9 | 6 |
| 4 | 16 | 10 |
| 5 | 25 | 15 |
| 6 | 36 | 21 |
| 7 | 49 | 28 |
| 8 | 64 | 36 |
| 9 | 81 | 45 |
| 10 | 100 | 55 |

## TypeScript (smaltdf)

The TypeScript examples run on a small `sales` table.

<!-- docs:setup CREATE TABLE sales (region TEXT, product TEXT, amount REAL); INSERT INTO sales VALUES ('North', 'Tea', 120), ('North', 'Coffee', 80), ('South', 'Tea', 95), ('South', 'Coffee', 140), ('South', 'Tea', 30); -->

```ts
table('sales')
  .groupBy('region')
  .agg(col('amount').sum().alias('total'), len().alias('sales'))
  .sort('region')
```

| region | total | sales |
| --- | --- | --- |
| North | 200 | 2 |
| South | 265 | 3 |

## Cypher (smaltcy)

The Cypher examples run on smaltcy's social sample: people, the cities they live in and the topics they like.

```cypher
MATCH (p:Person)-[:LIKES]->(t:Topic)
RETURN t.name AS topic, count(p) AS fans
ORDER BY fans DESC, topic
LIMIT 5
```

| topic | fans |
| --- | --- |
| Algorithms | 4 |
| Compilers | 3 |
| Languages | 3 |
| Networks | 2 |
| Graphs | 1 |
