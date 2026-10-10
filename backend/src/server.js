'use strict';
const path = require('path');
const express = require('express');
const neo4j = require('neo4j-driver');
const { driver, read, write, transaction, ensureSchema } = require('./db');
const { HttpError, hashPassword } = require('./util');
const { seed } = require('./seed');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public'))); // the simple frontend

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ------------------------------------------------------------------
// Validation helpers. They replace the CHECK / NOT NULL rules of the SQL document.
// ------------------------------------------------------------------
const bad = (msg) => new HttpError(400, msg);

const toInt = (v, name, min, max) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n)) throw bad(`${name} must be an integer`);
  if (min !== undefined && n < min) throw bad(`${name} must be >= ${min}`);
  if (max !== undefined && n > max) throw bad(`${name} must be <= ${max}`);
  return neo4j.int(n); // send a real Neo4j INTEGER (JS numbers are sent as FLOAT by default)
};

const toStr = (v, name, max, required = true) => {
  if (v === undefined || v === null || String(v).trim() === '') {
    if (required) throw bad(`${name} is required`);
    return null;
  }
  const s = String(v).trim();
  if (s.length > max) throw bad(`${name} must be at most ${max} characters`);
  return s;
};

const oneOf = (v, name, allowed) => {
  if (!allowed.includes(v)) throw bad(`${name} must be one of: ${allowed.join(', ')}`);
  return v;
};

// FOREIGN KEY check: the referenced node must exist
const mustExist = async (run, label, key, id, human) => {
  const [row] = await run(`MATCH (n:${label} {${key}: $id}) RETURN count(n) AS c`, { id });
  if (!row.c) throw new HttpError(404, `${human} not found`);
};

// ------------------------------------------------------------------
// Health + stats
// ------------------------------------------------------------------
app.get('/api/health', wrap(async (req, res) => {
  await read('RETURN 1 AS ok');
  res.json({ status: 'ok', database: 'neo4j' });
}));

// Section 10 (final verification): what is stored in the database
app.get('/api/stats', wrap(async (req, res) => {
  const nodes = await read(
    `MATCH (n) WHERE NOT n:Counter RETURN labels(n)[0] AS label, count(*) AS total ORDER BY label`
  );
  const relationships = await read(
    `MATCH ()-[x]->() RETURN type(x) AS type, count(*) AS total ORDER BY type`
  );
  res.json({ nodes, relationships });
}));

// Re-load the sample data (handy before a demo)
app.post('/api/reset', wrap(async (req, res) => {
  await seed();
  res.json({ message: 'Sample data reloaded' });
}));

// ------------------------------------------------------------------
// Department
// ------------------------------------------------------------------
app.get('/api/departments', wrap(async (req, res) => {
  res.json(await read(
    `MATCH (d:Department)
     RETURN d.department_id AS department_id, d.department_name AS department_name, d.description AS description
     ORDER BY department_id`
  ));
}));

app.post('/api/departments', wrap(async (req, res) => {
  const name = toStr(req.body.department_name, 'department_name', 50);
  const description = toStr(req.body.description, 'description', 200, false);
  const [row] = await write(
    `MERGE (c:Counter {name: 'department'}) ON CREATE SET c.value = 0
     SET c.value = c.value + 1
     CREATE (d:Department {department_id: c.value, department_name: $name, description: $description})
     RETURN d.department_id AS department_id`,
    { name, description }
  );
  res.status(201).json(row);
}));

// ------------------------------------------------------------------
// Subject
// ------------------------------------------------------------------
app.get('/api/subjects', wrap(async (req, res) => {
  res.json(await read(
    `MATCH (s:Subject)-[:IN_DEPARTMENT]->(d:Department)
     RETURN s.subject_id AS subject_id, s.subject_name AS subject_name, s.semester AS semester,
            d.department_id AS department_id, d.department_name AS department_name
     ORDER BY subject_id`
  ));
}));

app.post('/api/subjects', wrap(async (req, res) => {
  const name = toStr(req.body.subject_name, 'subject_name', 100);
  const semester = toInt(req.body.semester, 'semester', 1, 8); // CHECK (semester BETWEEN 1 AND 8)
  const did = toInt(req.body.department_id, 'department_id', 1);
  const rows = await write(
    `MATCH (d:Department {department_id: $did})
     MERGE (c:Counter {name: 'subject'}) ON CREATE SET c.value = 100
     SET c.value = c.value + 1
     CREATE (s:Subject {subject_id: c.value, subject_name: $name, semester: $semester})-[:IN_DEPARTMENT]->(d)
     RETURN s.subject_id AS subject_id`,
    { name, semester, did }
  );
  if (!rows.length) throw new HttpError(404, 'Department not found');
  res.status(201).json(rows[0]);
}));

// ------------------------------------------------------------------
// Users (password is never returned)
// ------------------------------------------------------------------
app.get('/api/users', wrap(async (req, res) => {
  res.json(await read(
    `MATCH (u:User)-[:MEMBER_OF]->(d:Department)
     RETURN u.user_id AS user_id, u.name AS name, u.email AS email, u.phone AS phone,
            u.student_year AS student_year, d.department_name AS department_name
     ORDER BY user_id`
  ));
}));

app.post('/api/users', wrap(async (req, res) => {
  const name = toStr(req.body.name, 'name', 100);
  const email = toStr(req.body.email, 'email', 100);
  if (!/^\S+@\S+\.\S+$/.test(email)) throw bad('email is not valid');
  const password = toStr(req.body.password, 'password', 100);
  const phone = toStr(req.body.phone, 'phone', 15, false);
  const year = toInt(req.body.student_year, 'student_year', 1, 4); // CHECK (student_year BETWEEN 1 AND 4)
  const did = toInt(req.body.department_id, 'department_id', 1);
  const rows = await write(
    `MATCH (d:Department {department_id: $did})
     MERGE (c:Counter {name: 'user'}) ON CREATE SET c.value = 0
     SET c.value = c.value + 1
     CREATE (u:User {user_id: c.value, name: $name, email: $email, user_password: $pw, phone: $phone, student_year: $year})-[:MEMBER_OF]->(d)
     RETURN u.user_id AS user_id`,
    { name, email, pw: hashPassword(password), phone, year, did }
  );
  if (!rows.length) throw new HttpError(404, 'Department not found');
  res.status(201).json(rows[0]);
}));

// ------------------------------------------------------------------
// Resources
//   GET /api/resources?type=digital|physical&status=available|borrowed&subject_id=101&q=dbms
//   covers sections 4.4 - 4.9 of the document (all / available / physical / digital / with subject / with owner)
// ------------------------------------------------------------------
app.get('/api/resources', wrap(async (req, res) => {
  const type = req.query.type ? oneOf(req.query.type, 'type', ['digital', 'physical']) : null;
  const status = req.query.status ? oneOf(req.query.status, 'status', ['available', 'borrowed']) : null;
  const subject = req.query.subject_id ? toInt(req.query.subject_id, 'subject_id') : null;
  const q = req.query.q ? String(req.query.q) : null;
  res.json(await read(
    `MATCH (o:User)-[:OWNS]->(r:Resource)-[:BELONGS_TO]->(s:Subject)
     WHERE ($type IS NULL OR r.resource_type = $type)
       AND ($status IS NULL OR r.status = $status)
       AND ($subject IS NULL OR s.subject_id = $subject)
       AND ($q IS NULL OR toLower(r.title) CONTAINS toLower($q))
     RETURN r.resource_id AS resource_id, r.title AS title, r.description AS description,
            r.resource_type AS resource_type, r.category AS category, r.status AS status,
            r.download_count AS download_count, r.file_url AS file_url,
            toString(r.upload_date) AS upload_date,
            s.subject_id AS subject_id, s.subject_name AS subject_name,
            o.user_id AS owner_id, o.name AS uploaded_by
     ORDER BY resource_id`,
    { type, status, subject, q }
  ));
}));

app.post('/api/resources', wrap(async (req, res) => {
  const title = toStr(req.body.title, 'title', 150);
  const description = toStr(req.body.description, 'description', 500, false);
  const type = oneOf(req.body.resource_type, 'resource_type', ['digital', 'physical']); // CHECK
  const category = toStr(req.body.category, 'category', 50, false);
  const fileUrl = toStr(req.body.file_url, 'file_url', 300, false);
  const sid = toInt(req.body.subject_id, 'subject_id', 1);
  const oid = toInt(req.body.owner_id, 'owner_id', 1);
  const rows = await write(
    `MATCH (s:Subject {subject_id: $sid}), (o:User {user_id: $oid})
     MERGE (c:Counter {name: 'resource'}) ON CREATE SET c.value = 1000
     SET c.value = c.value + 1
     CREATE (r:Resource {resource_id: c.value, title: $title, description: $description,
                         resource_type: $type, category: $category,
                         upload_date: date(),            // trigger 8.1: default upload date
                         file_url: $fileUrl, status: 'available', download_count: 0})
     CREATE (o)-[:OWNS]->(r), (r)-[:BELONGS_TO]->(s)
     RETURN r.resource_id AS resource_id`,
    { sid, oid, title, description, type, category, fileUrl }
  );
  if (!rows.length) throw new HttpError(404, 'Subject or owner not found');
  res.status(201).json(rows[0]);
}));

// Section 5.2: UPDATE download_count = download_count + 1
app.post('/api/resources/:id/download', wrap(async (req, res) => {
  const id = toInt(req.params.id, 'resource id');
  const rows = await write(
    `MATCH (r:Resource {resource_id: $id}) WHERE r.resource_type = 'digital'
     SET r.download_count = r.download_count + 1
     RETURN r.resource_id AS resource_id, r.title AS title, r.download_count AS download_count`,
    { id }
  );
  if (rows.length) return res.json(rows[0]);
  const [e] = await read('MATCH (r:Resource {resource_id: $id}) RETURN count(r) AS c', { id });
  throw e.c ? new HttpError(422, 'Only digital resources can be downloaded') : new HttpError(404, 'Resource not found');
}));

// ------------------------------------------------------------------
// Borrow / Return  (replace PL/SQL procedures borrow_resource, return_resource,
// function calculate_fine and trigger trg_check_borrow)
// Each one runs as ONE ACID transaction: any error => full rollback.
// ------------------------------------------------------------------
app.post('/api/borrow', wrap(async (req, res) => {
  const uid = toInt(req.body.user_id, 'user_id', 1);
  const rid = toInt(req.body.resource_id, 'resource_id', 1);

  const result = await transaction(async (run) => {
    await mustExist(run, 'User', 'user_id', uid, 'User');

    // Take a write lock on the resource first, so two people can't borrow it at the same moment.
    const locked = await run(
      `MATCH (r:Resource {resource_id: $rid})
       SET r.lock_version = coalesce(r.lock_version, 0) + 1
       RETURN r.resource_id AS id`,
      { rid }
    );
    if (!locked.length) throw new HttpError(404, 'Resource not found');

    // Checks from the procedure + trigger trg_check_borrow
    const [r] = await run(
      'MATCH (r:Resource {resource_id: $rid}) RETURN r.resource_type AS type, r.status AS status',
      { rid }
    );
    if (r.type !== 'physical') throw new HttpError(422, 'Only physical resources can be borrowed');
    if (r.status !== 'available') throw new HttpError(409, 'Resource is not available');

    const [b] = await run(
      `MATCH (u:User {user_id: $uid}), (r:Resource {resource_id: $rid})
       MERGE (c:Counter {name: 'borrow'}) ON CREATE SET c.value = 0
       SET c.value = c.value + 1, r.status = 'borrowed'
       CREATE (b:Borrow {borrow_id: c.value, borrow_date: date(),
                         due_date: date() + duration({days: 7}), borrow_status: 'borrowed'})
       CREATE (u)-[:BORROWED]->(b)-[:FOR_RESOURCE]->(r)
       RETURN b.borrow_id AS borrow_id, toString(b.borrow_date) AS borrow_date, toString(b.due_date) AS due_date`,
      { uid, rid }
    );
    return b;
  });

  res.status(201).json({ message: 'Resource borrowed successfully', ...result });
}));

app.post('/api/return', wrap(async (req, res) => {
  const bid = toInt(req.body.borrow_id, 'borrow_id', 1);
  const condition = toStr(req.body.resource_condition, 'resource_condition', 100, false);
  // optional, only to demonstrate fines without waiting a week (format YYYY-MM-DD)
  let returnDate = null;
  if (req.body.return_date) {
    returnDate = String(req.body.return_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) throw bad('return_date must be YYYY-MM-DD');
  }

  const result = await transaction(async (run) => {
    const found = await run(
      `MATCH (b:Borrow {borrow_id: $bid})-[:FOR_RESOURCE]->(r:Resource)
       SET r.lock_version = coalesce(r.lock_version, 0) + 1
       RETURN b.borrow_status AS status`,
      { bid }
    );
    if (!found.length) throw new HttpError(404, 'Borrow record not found');
    if (found[0].status !== 'borrowed') throw new HttpError(409, 'This borrow has already been returned');

    // fine = days late * Rs.10 (function calculate_fine)
    const [out] = await run(
      `MATCH (b:Borrow {borrow_id: $bid})-[:FOR_RESOURCE]->(r:Resource)
       MERGE (c:Counter {name: 'return'}) ON CREATE SET c.value = 0
       SET c.value = c.value + 1
       WITH b, r, c, CASE WHEN $returnDate IS NULL THEN date() ELSE date($returnDate) END AS rdate
       WITH b, r, c, rdate, duration.inDays(b.due_date, rdate).days AS late
       WITH b, r, c, rdate, CASE WHEN late > 0 THEN late * 10.0 ELSE 0.0 END AS fine
       SET b.borrow_status = 'returned', r.status = 'available'
       CREATE (rl:ReturnLog {return_id: c.value, return_date: rdate, fine_amount: fine,
                             resource_condition: $condition, borrow_id: b.borrow_id})
       CREATE (b)-[:HAS_RETURN]->(rl)
       RETURN rl.return_id AS return_id, toString(rdate) AS return_date, fine AS fine_amount`,
      { bid, condition, returnDate }
    );
    return out;
  });

  res.json({ message: 'Resource returned successfully', ...result });
}));

// Section 6.4: borrow records with user + resource (+ return info if returned)
app.get('/api/borrows', wrap(async (req, res) => {
  res.json(await read(
    `MATCH (u:User)-[:BORROWED]->(b:Borrow)-[:FOR_RESOURCE]->(r:Resource)
     OPTIONAL MATCH (b)-[:HAS_RETURN]->(rl:ReturnLog)
     RETURN b.borrow_id AS borrow_id, u.name AS name, r.title AS title,
            toString(b.borrow_date) AS borrow_date, toString(b.due_date) AS due_date,
            b.borrow_status AS borrow_status, toString(rl.return_date) AS return_date,
            rl.fine_amount AS fine_amount, rl.resource_condition AS resource_condition
     ORDER BY borrow_id`
  ));
}));

// ------------------------------------------------------------------
// Ratings  (UNIQUE (user_id, resource_id) is enforced by checking before create)
// ------------------------------------------------------------------
app.get('/api/ratings', wrap(async (req, res) => {
  res.json(await read(
    `MATCH (u:User)-[x:RATED]->(r:Resource)
     RETURN x.rating_id AS rating_id, u.name AS user, r.title AS title,
            x.rating_value AS rating_value, x.review AS review, toString(x.rating_date) AS rating_date
     ORDER BY rating_id`
  ));
}));

// Section 7 (cursor): every resource with its average rating
app.get('/api/ratings/average', wrap(async (req, res) => {
  res.json(await read(
    `MATCH (r:Resource)
     OPTIONAL MATCH (:User)-[x:RATED]->(r)
     RETURN r.resource_id AS resource_id, r.title AS title,
            round(coalesce(avg(x.rating_value), 0) * 100) / 100 AS avg_rating, count(x) AS total_ratings
     ORDER BY resource_id`
  ));
}));

app.post('/api/ratings', wrap(async (req, res) => {
  const uid = toInt(req.body.user_id, 'user_id', 1);
  const rid = toInt(req.body.resource_id, 'resource_id', 1);
  const value = toInt(req.body.rating_value, 'rating_value', 1, 5); // CHECK (1..5)
  const review = toStr(req.body.review, 'review', 500, false);
  const out = await transaction(async (run) => {
    await mustExist(run, 'User', 'user_id', uid, 'User');
    await mustExist(run, 'Resource', 'resource_id', rid, 'Resource');
    const [d] = await run(
      'MATCH (:User {user_id: $uid})-[x:RATED]->(:Resource {resource_id: $rid}) RETURN count(x) AS c',
      { uid, rid }
    );
    if (d.c) throw new HttpError(409, 'You have already rated this resource');
    const [row] = await run(
      `MATCH (u:User {user_id: $uid}), (r:Resource {resource_id: $rid})
       MERGE (c:Counter {name: 'rating'}) ON CREATE SET c.value = 0
       SET c.value = c.value + 1
       CREATE (u)-[x:RATED {rating_id: c.value, rating_value: $value, review: $review, rating_date: date()}]->(r)
       RETURN x.rating_id AS rating_id`,
      { uid, rid, value, review }
    );
    return row;
  });
  res.status(201).json(out);
}));

// ------------------------------------------------------------------
// Favorites
// ------------------------------------------------------------------
app.get('/api/favorites', wrap(async (req, res) => {
  res.json(await read(
    `MATCH (u:User)-[f:FAVORITED]->(r:Resource)
     RETURN f.favorite_id AS favorite_id, u.user_id AS user_id, u.name AS user, r.title AS title,
            toString(f.added_date) AS added_date
     ORDER BY favorite_id`
  ));
}));

app.post('/api/favorites', wrap(async (req, res) => {
  const uid = toInt(req.body.user_id, 'user_id', 1);
  const rid = toInt(req.body.resource_id, 'resource_id', 1);
  const out = await transaction(async (run) => {
    await mustExist(run, 'User', 'user_id', uid, 'User');
    await mustExist(run, 'Resource', 'resource_id', rid, 'Resource');
    const [d] = await run(
      'MATCH (:User {user_id: $uid})-[f:FAVORITED]->(:Resource {resource_id: $rid}) RETURN count(f) AS c',
      { uid, rid }
    );
    if (d.c) throw new HttpError(409, 'Already in favorites');
    const [row] = await run(
      `MATCH (u:User {user_id: $uid}), (r:Resource {resource_id: $rid})
       MERGE (c:Counter {name: 'favorite'}) ON CREATE SET c.value = 0
       SET c.value = c.value + 1
       CREATE (u)-[f:FAVORITED {favorite_id: c.value, added_date: date()}]->(r)
       RETURN f.favorite_id AS favorite_id`,
      { uid, rid }
    );
    return row;
  });
  res.status(201).json(out);
}));

// Section 5.3: DELETE a favorite
app.delete('/api/favorites/:id', wrap(async (req, res) => {
  const id = toInt(req.params.id, 'favorite id');
  const rows = await write(
    'MATCH (:User)-[f:FAVORITED {favorite_id: $id}]->(:Resource) DELETE f RETURN count(*) AS deleted',
    { id }
  );
  if (!rows.length || !rows[0].deleted) throw new HttpError(404, 'Favorite not found');
  res.json({ message: 'Favorite deleted' });
}));

// ------------------------------------------------------------------
// Reports
// ------------------------------------------------------------------
app.get('/api/reports', wrap(async (req, res) => {
  res.json(await read(
    `MATCH (u:User)-[:REPORTED]->(rep:Report)-[:ABOUT]->(r:Resource)
     RETURN rep.report_id AS report_id, rep.reason AS reason, rep.status AS status,
            toString(rep.report_date) AS report_date, u.name AS reported_by, r.title AS title
     ORDER BY report_id`
  ));
}));

app.post('/api/reports', wrap(async (req, res) => {
  const uid = toInt(req.body.user_id, 'user_id', 1);
  const rid = toInt(req.body.resource_id, 'resource_id', 1);
  const reason = toStr(req.body.reason, 'reason', 500);
  const rows = await write(
    `MATCH (u:User {user_id: $uid}), (r:Resource {resource_id: $rid})
     MERGE (c:Counter {name: 'report'}) ON CREATE SET c.value = 0
     SET c.value = c.value + 1
     CREATE (u)-[:REPORTED]->(rep:Report {report_id: c.value, reason: $reason, status: 'pending', report_date: date()})-[:ABOUT]->(r)
     RETURN rep.report_id AS report_id`,
    { uid, rid, reason }
  );
  if (!rows.length) throw new HttpError(404, 'User or resource not found');
  res.status(201).json(rows[0]);
}));

// Section 5.1: UPDATE report status
app.patch('/api/reports/:id', wrap(async (req, res) => {
  const id = toInt(req.params.id, 'report id');
  const status = oneOf(req.body.status, 'status', ['pending', 'resolved', 'rejected']);
  const rows = await write(
    `MATCH (rep:Report {report_id: $id}) SET rep.status = $status
     RETURN rep.report_id AS report_id, rep.status AS status`,
    { id, status }
  );
  if (!rows.length) throw new HttpError(404, 'Report not found');
  res.json(rows[0]);
}));

// ------------------------------------------------------------------
// Errors
// ------------------------------------------------------------------
app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API route' }));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.code === 'Neo.ClientError.Schema.ConstraintValidationFailed') {
    return res.status(409).json({ error: 'Duplicate value (unique constraint violated)', detail: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error', detail: err.message });
});

// ------------------------------------------------------------------
// Start-up: wait for Neo4j, create constraints, load sample data if the DB is empty
// ------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start() {
  for (let attempt = 1; ; attempt++) {
    try {
      await driver.verifyConnectivity();
      break;
    } catch (e) {
      if (attempt >= 30) throw e;
      console.log(`Waiting for Neo4j (${attempt}/30)...`);
      await sleep(2000);
    }
  }
  await ensureSchema();
  const [{ c }] = await read('MATCH (d:Department) RETURN count(d) AS c');
  if (c === 0) {
    await seed();
    console.log('Sample data loaded.');
  }
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Resource Sharing System running on http://localhost:${port}`));
}

start().catch((e) => {
  console.error('Failed to start:', e);
  process.exit(1);
});
