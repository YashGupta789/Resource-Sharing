# Resource Sharing System — Node.js + Neo4j (NoSQL graph database) + Docker

Re-implementation of the Oracle SQL / PL-SQL "Resource Sharing System" document on a **NoSQL** database
(not MySQL, not SQL*Plus, not MongoDB), with a REST backend and a simple web frontend.

---

## 1. Which NoSQL database, and why Neo4j?

Your document has 9 tables that are almost all connected by foreign keys, plus multi-step
business logic (borrow / return / fine) that must be **all-or-nothing**. That points to a database that
(a) models relationships natively and (b) supports real transactions.

| Database | Type | Fit for this project |
|---|---|---|
| **Neo4j (chosen)** | Graph | Foreign keys become relationships; "JOIN" = follow an edge; **ACID multi-statement transactions** (borrow/return); unique constraints; a built-in **visual browser** that makes a great demo; huge amount of tutorials; official Docker image |
| ArangoDB | Document + graph | Also a good fit (JSON schema validation, transactions) but smaller community and less learning material |
| Cassandra | Wide-column | Poor fit: no joins, no real transactions, you must design one table per query |
| CouchDB | Document | No joins, no multi-document transactions |
| Redis | Key-value | Possible, but joins/aggregates/relationships would all be hand-written |
| DynamoDB (local) | Key-value/document | Needs single-table design tricks; hard to explain in a viva |

**Short viva answer:** *"Our data is highly connected (users, resources, subjects, departments, borrows, ratings, favorites,
reports) and we need ACID transactions for borrow/return, so we chose the Neo4j graph database. It is NoSQL, queried with Cypher."*

---

## 2. What you get

```
resource-sharing-system/
├── docker-compose.yml          # Neo4j + the API in two containers
├── backend/
│   ├── Dockerfile
│   ├── package.json            # express + neo4j-driver
│   ├── src/
│   │   ├── server.js           # REST API (all business logic, validation, transactions)
│   │   ├── db.js               # driver, read/write/transaction helpers, constraints
│   │   ├── seed.js             # sample data from sections 2.1-2.7 of your document
│   │   └── util.js             # HttpError + password hashing
│   └── public/index.html       # the simple frontend (served by the API)
├── cypher/resource_sharing.cypher   # the whole document redone in Cypher (for QUERY / OUTPUT screenshots)
└── scripts/smoke-test.sh       # curl-based end-to-end test
```

## 3. Run it (3 commands)

Install **Docker Desktop**, then in this folder:

```bash
docker compose up --build
```

Wait until you see `Resource Sharing System running on http://localhost:3000` (first start takes ~1 minute
while Neo4j boots). Then open:

| URL | What |
|---|---|
| http://localhost:3000 | **Your frontend** (use this for the demo) |
| http://localhost:3000/api/health | Backend health check |
| http://localhost:7474 | **Neo4j Browser** — login `neo4j` / `resource123`, connect URL `bolt://localhost:7687` |

Stop: `Ctrl+C`, then `docker compose down`.
Wipe all data too: `docker compose down -v`.
Run the API test: `bash scripts/smoke-test.sh`.

Without Docker for the API (only Neo4j in Docker): `docker compose up neo4j`, then
`cd backend && npm install && npm start`.

---

## 4. How the SQL document maps to Neo4j

### Tables → node labels, foreign keys → relationships

```
(User)-[:MEMBER_OF]->(Department)<-[:IN_DEPARTMENT]-(Subject)<-[:BELONGS_TO]-(Resource)<-[:OWNS]-(User)
(User)-[:BORROWED]->(Borrow)-[:FOR_RESOURCE]->(Resource)
(Borrow)-[:HAS_RETURN]->(ReturnLog)
(User)-[:RATED {rating_id, rating_value, review, rating_date}]->(Resource)
(User)-[:FAVORITED {favorite_id, added_date}]->(Resource)
(User)-[:REPORTED]->(Report {report_id, reason, status, report_date})-[:ABOUT]->(Resource)
```

| SQL table | Neo4j | Why |
|---|---|---|
| department, subject, users, resources | nodes `Department`, `Subject`, `User`, `Resource` | normal entities |
| borrow, return_log | nodes `Borrow`, `ReturnLog` | they have their own id, status and lifecycle |
| rating, favorite | **relationships** `RATED`, `FAVORITED` with properties | a rating/favorite *is* a link between a user and a resource; one edge per pair = the `UNIQUE(user_id, resource_id)` rule |
| report | node `Report` + relationships | several reports per user/resource are allowed and its status is updated |

### SQL features → what replaces them

| In your document | In this project |
|---|---|
| `PRIMARY KEY`, `UNIQUE` | Neo4j **uniqueness constraints** (`db.js`, section 1 of the .cypher file) |
| `NOT NULL`, `CHECK` (semester 1-8, year 1-4, rating 1-5, type digital/physical, status values) | validation functions in `server.js` (`toInt`, `toStr`, `oneOf`) — Neo4j Community has no CHECK/NOT NULL |
| `FOREIGN KEY` | relationship created in the same query as a `MATCH` of the referenced node; if it doesn't exist the API returns 404 |
| `DEFAULT sysdate` | `date()` in Cypher |
| Sequences `borrow_seq`, `return_seq` | `Counter` nodes, incremented atomically inside the creating query |
| `JOIN` | `MATCH (a)-[:REL]->(b)` |
| Procedure `borrow_resource` | `POST /api/borrow` — one ACID transaction |
| Procedure `return_resource` + function `calculate_fine` | `POST /api/return` — one ACID transaction, fine = late days × Rs.10 |
| Cursor (average rating per resource) | aggregation query `GET /api/ratings/average` |
| Trigger `trg_resource_date` | `date()` set when the resource node is created |
| Trigger `trg_check_borrow` | checks inside the borrow transaction (digital → 422, already borrowed → 409) |
| `COMMIT` / `ROLLBACK` | transaction commits when the function returns, rolls back if it throws |
| `user_tables`, `user_objects` | `SHOW CONSTRAINTS`, `SHOW INDEXES`, `CALL db.labels()` |

> Neo4j Community has no native triggers. If your faculty insists on "real" triggers, the APOC plugin offers
> `apoc.trigger.install(...)`; the in-transaction checks above do the same job and are easier to explain.

**Concurrency detail (good viva point):** before borrowing, the transaction writes to the resource node
(`lock_version`), which takes a lock. Two users clicking "Borrow" at the same moment are serialised, so one
gets "Resource is not available" instead of both succeeding.

---

## 5. REST API

| Method & path | Does | Document section |
|---|---|---|
| `GET /api/departments` · `POST` | list / add department | 2.1, 4.1 |
| `GET /api/subjects` · `POST` | list (with department) / add | 2.2, 4.2 |
| `GET /api/users` · `POST` | list (no passwords) / register (hashed password) | 2.3, 4.3 |
| `GET /api/resources?type=&status=&subject_id=&q=` | all / available / physical / digital, with subject and owner | 4.4 – 4.9 |
| `POST /api/resources` | add resource (`owner_id`, `subject_id`, `resource_type`…) | 2.4, trigger 8.1 |
| `POST /api/resources/:id/download` | download_count + 1 (digital only) | 5.2 |
| `POST /api/borrow` `{user_id, resource_id}` | borrow (due in 7 days) | 6.2, 6.3, trigger 8.2 |
| `POST /api/return` `{borrow_id, resource_condition, return_date?}` | return + fine | 6.5, 6.6, 6.8 |
| `GET /api/borrows` | borrow records | 6.4 |
| `GET /api/ratings` · `POST` | list / rate (1-5, once per user+resource) | 2.5 |
| `GET /api/ratings/average` | average rating per resource | 7 (cursor) |
| `GET /api/favorites` · `POST` · `DELETE /api/favorites/:id` | list / add / remove | 2.6, 5.3 |
| `GET /api/reports` · `POST` · `PATCH /api/reports/:id` `{status}` | list / report / resolve or reject | 2.7, 5.1 |
| `GET /api/stats` | node & relationship counts | 10 |
| `POST /api/reset` | reload sample data | — |

Example:
```bash
curl -X POST localhost:3000/api/borrow -H 'Content-Type: application/json' -d '{"user_id":2,"resource_id":1003}'
```

---

## 6. Suggested demo (≈ 5 minutes)

1. Open http://localhost:3000 → **Dashboard**: node/relationship counts and average ratings come from Neo4j.
2. **Resources** tab → filter *physical* + *available*. Choose **Acting as: Priya**, click **Borrow** on "Operating Systems Book".
   The status turns *borrowed*; look at the black "Last API call" panel at the bottom (proof of backend + DB).
3. Click **Borrow** again as Rahul → error *"Resource is not available"* (trigger/transaction rule).
   Try borrowing a digital resource → *"Only physical resources can be borrowed"*.
4. **Borrow / Return** tab → pick a *return date* 12 days ahead → **Return** → fine **Rs.120**; the resource is available again.
5. **Resources** → **Rate** with 6 → rejected (CHECK 1-5); rate with 4 → saved; rate again → duplicate rejected.
6. **Favorites** → remove one (DELETE). **Reports** → Resolve the pending report (UPDATE).
7. Open **Neo4j Browser** (link in the header) and run
   `MATCH p=(n)-[]->(m) WHERE NOT n:Counter AND NOT m:Counter RETURN p` to show the graph visually.
   Run the same borrow in Cypher to prove the data is really in the graph database.

## 7. Filling your project document (QUERY / OUTPUT format)

`cypher/resource_sharing.cypher` follows your document's numbering (1 … 10). Open Neo4j Browser, paste each
statement, run it and screenshot the result for the **OUTPUT** part. For "PL/SQL" sections (6–8) also show the
API call (Postman / curl / the frontend log panel). Section 0 wipes the database first.

## 8. Likely viva questions

* **Why NoSQL / why graph?** Highly connected data; relationships are first-class so joins are cheap; flexible schema.
* **Where are the foreign keys?** Relationships; the API creates them only when both nodes exist.
* **How do you avoid two people borrowing the same book?** Transaction + write lock on the resource node.
* **How are sequences done?** `Counter` nodes incremented atomically in the same transaction as the insert.
* **Are passwords safe?** Salted scrypt hashes (the SQL doc used plain text).
* **What are the limitations?** No CHECK constraints / native triggers in the Community edition → enforced in the service layer.

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| Port 7474 / 7687 / 3000 already used | stop the other program or change the left side of the port in `docker-compose.yml` |
| API shows "Waiting for Neo4j" for a while | normal on first start; it retries for ~60 s |
| `AuthenticationRateLimit` / unauthorized | the password is stored in the volume the first time; run `docker compose down -v` and start again |
| Changed backend code | `docker compose up --build` |
| Want a clean database | click **Reset demo data**, or `docker compose down -v` |
