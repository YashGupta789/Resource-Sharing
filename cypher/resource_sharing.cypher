// =====================================================================
//  RESOURCE SHARING SYSTEM - Cypher equivalent of the SQL/PL-SQL document
//  Run in Neo4j Browser (http://localhost:7474, user neo4j / pass resource123)
//  Paste ONE statement at a time (or whole blocks) and take a screenshot for the OUTPUT part.
//  Section 0 wipes the database, so don't run it if you want to keep your own data.
// =====================================================================

// ---------- 0. CLEAN START (optional) ----------
MATCH (n) DETACH DELETE n;

// ---------- 1. "TABLE CREATION" = constraints (PRIMARY KEY / UNIQUE) ----------
// Neo4j is schema-less: a table becomes a node label, a row becomes a node,
// a foreign key becomes a relationship.  (The API already creates these at start-up.)
CREATE CONSTRAINT department_id_unique IF NOT EXISTS FOR (n:Department) REQUIRE n.department_id IS UNIQUE;
CREATE CONSTRAINT department_name_unique IF NOT EXISTS FOR (n:Department) REQUIRE n.department_name IS UNIQUE;
CREATE CONSTRAINT subject_id_unique IF NOT EXISTS FOR (n:Subject) REQUIRE n.subject_id IS UNIQUE;
CREATE CONSTRAINT user_id_unique IF NOT EXISTS FOR (n:User) REQUIRE n.user_id IS UNIQUE;
CREATE CONSTRAINT user_email_unique IF NOT EXISTS FOR (n:User) REQUIRE n.email IS UNIQUE;
CREATE CONSTRAINT resource_id_unique IF NOT EXISTS FOR (n:Resource) REQUIRE n.resource_id IS UNIQUE;
CREATE CONSTRAINT borrow_id_unique IF NOT EXISTS FOR (n:Borrow) REQUIRE n.borrow_id IS UNIQUE;
CREATE CONSTRAINT return_id_unique IF NOT EXISTS FOR (n:ReturnLog) REQUIRE n.return_id IS UNIQUE;
CREATE CONSTRAINT return_borrow_unique IF NOT EXISTS FOR (n:ReturnLog) REQUIRE n.borrow_id IS UNIQUE;
CREATE CONSTRAINT report_id_unique IF NOT EXISTS FOR (n:Report) REQUIRE n.report_id IS UNIQUE;
CREATE CONSTRAINT counter_name_unique IF NOT EXISTS FOR (n:Counter) REQUIRE n.name IS UNIQUE;

SHOW CONSTRAINTS;

// ---------- 2. INSERTION ----------
// 2.1 Department
CREATE (:Department {department_id:1, department_name:'CSE',  description:'Computer Science and Engineering'}),
       (:Department {department_id:2, department_name:'ECE',  description:'Electronics and Communication Engineering'}),
       (:Department {department_id:3, department_name:'MECH', description:'Mechanical Engineering'});

// 2.2 Subject   (foreign key subject.department_id  ->  relationship IN_DEPARTMENT)
UNWIND [
  {id:101, name:'Database Management Systems', sem:4, dept:1},
  {id:102, name:'Operating Systems',           sem:4, dept:1},
  {id:103, name:'Computer Networks',           sem:5, dept:1},
  {id:104, name:'Digital Electronics',         sem:4, dept:2},
  {id:105, name:'Engineering Mechanics',       sem:3, dept:3}
] AS s
MATCH (d:Department {department_id:s.dept})
CREATE (:Subject {subject_id:s.id, subject_name:s.name, semester:s.sem})-[:IN_DEPARTMENT]->(d);

// 2.3 Users  (demo only: the API stores salted hashes, not plain passwords)
UNWIND [
  {id:1, name:'Rahul', email:'rahul@gmail.com', pw:'rahul123', phone:'9876543210', year:2, dept:1},
  {id:2, name:'Priya', email:'priya@gmail.com', pw:'priya123', phone:'9876543211', year:2, dept:1},
  {id:3, name:'Arjun', email:'arjun@gmail.com', pw:'arjun123', phone:'9876543212', year:3, dept:1},
  {id:4, name:'Sneha', email:'sneha@gmail.com', pw:'sneha123', phone:'9876543213', year:2, dept:2}
] AS u
MATCH (d:Department {department_id:u.dept})
CREATE (:User {user_id:u.id, name:u.name, email:u.email, user_password:u.pw, phone:u.phone, student_year:u.year})-[:MEMBER_OF]->(d);

// 2.4 Resources  (owner_id -> OWNS, subject_id -> BELONGS_TO)
UNWIND [
  {id:1001, title:'DBMS Unit 1 Notes',      d:'Complete Unit 1 notes',          type:'digital',  cat:'Notes',          url:'dbms_unit1.pdf', subj:101, owner:1},
  {id:1002, title:'DBMS Lab Manual',        d:'DBMS laboratory exercises',      type:'digital',  cat:'Lab Manual',     url:'dbms_lab.pdf',   subj:101, owner:2},
  {id:1003, title:'Operating Systems Book', d:'OS reference book',              type:'physical', cat:'Book',           url:null,             subj:102, owner:3},
  {id:1004, title:'Computer Networks PYQs', d:'Previous year question papers',  type:'digital',  cat:'Question Paper', url:'cn_pyq.pdf',     subj:103, owner:1}
] AS r
MATCH (s:Subject {subject_id:r.subj}), (o:User {user_id:r.owner})
CREATE (res:Resource {resource_id:r.id, title:r.title, description:r.d, resource_type:r.type, category:r.cat,
                      upload_date:date(), file_url:r.url, status:'available', download_count:0})
CREATE (o)-[:OWNS]->(res), (res)-[:BELONGS_TO]->(s);

// 2.5 Rating  (a rating is a relationship with properties; UNIQUE(user,resource) = one RATED edge per pair)
UNWIND [
  {id:1, v:5, review:'Very useful notes',           u:2, r:1001},
  {id:2, v:4, review:'Good explanation',            u:3, r:1001},
  {id:3, v:5, review:'Helpful for lab preparation', u:1, r:1002}
] AS x
MATCH (u:User {user_id:x.u}), (r:Resource {resource_id:x.r})
CREATE (u)-[:RATED {rating_id:x.id, rating_value:x.v, review:x.review, rating_date:date()}]->(r);

// 2.6 Favorite
UNWIND [{id:1,u:2,r:1001},{id:2,u:3,r:1001},{id:3,u:1,r:1004}] AS x
MATCH (u:User {user_id:x.u}), (r:Resource {resource_id:x.r})
CREATE (u)-[:FAVORITED {favorite_id:x.id, added_date:date()}]->(r);

// 2.7 Report
MATCH (u:User {user_id:2}), (r:Resource {resource_id:1004})
CREATE (u)-[:REPORTED]->(:Report {report_id:1, reason:'File contains incorrect material', status:'pending', report_date:date()})-[:ABOUT]->(r);

// ---------- 3. "SEQUENCES" = counter nodes (atomic increment inside a transaction) ----------
UNWIND [
  {name:'department', value:3}, {name:'subject', value:105}, {name:'user', value:4},
  {name:'resource', value:1004}, {name:'borrow', value:0},   {name:'return', value:0},
  {name:'rating', value:3},     {name:'favorite', value:3},  {name:'report', value:1}
] AS c
CREATE (:Counter {name:c.name, value:c.value});

// borrow_seq.NEXTVAL equivalent:
MERGE (c:Counter {name:'borrow'}) ON CREATE SET c.value = 0
SET c.value = c.value + 1
RETURN c.value AS next_borrow_id;
// (that incremented it - put it back so the demo below gets id 1)
MATCH (c:Counter {name:'borrow'}) SET c.value = 0 RETURN c.value;

// ---------- 4. QUERIES ----------
// 4.1 - 4.3
MATCH (d:Department) RETURN d.department_id, d.department_name, d.description ORDER BY d.department_id;
MATCH (s:Subject) RETURN s.subject_id, s.subject_name, s.semester ORDER BY s.subject_id;
MATCH (u:User) RETURN u.user_id, u.name, u.email, u.phone, u.student_year ORDER BY u.user_id;

// 4.4 all resources
MATCH (r:Resource) RETURN r.resource_id, r.title, r.resource_type, r.category, r.status, r.download_count ORDER BY r.resource_id;

// 4.5 available resources
MATCH (r:Resource {status:'available'}) RETURN r.resource_id, r.title, r.resource_type, r.status ORDER BY r.resource_id;

// 4.6 physical / 4.7 digital
MATCH (r:Resource {resource_type:'physical'}) RETURN r.resource_id, r.title, r.category;
MATCH (r:Resource {resource_type:'digital'})  RETURN r.resource_id, r.title, r.category;

// 4.8 resources with subject name  (JOIN = following a relationship)
MATCH (r:Resource)-[:BELONGS_TO]->(s:Subject)
RETURN r.resource_id, r.title, s.subject_name ORDER BY r.resource_id;

// 4.9 resources with owner name
MATCH (u:User)-[:OWNS]->(r:Resource)
RETURN r.resource_id, r.title, u.name AS uploaded_by ORDER BY r.resource_id;

// ---------- 5. UPDATE AND DELETE ----------
// 5.1 update report status
MATCH (rep:Report {report_id:1}) SET rep.status = 'resolved' RETURN rep;

// 5.2 download count + 1
MATCH (r:Resource {resource_id:1001}) SET r.download_count = r.download_count + 1
RETURN r.resource_id, r.title, r.download_count;

// 5.3 delete a favorite
MATCH (:User)-[f:FAVORITED {favorite_id:3}]->(:Resource) DELETE f;
MATCH (u:User)-[f:FAVORITED]->(r:Resource) RETURN f.favorite_id, u.name, r.title;

// ---------- 6. "PL/SQL" = transactions (the API wraps these in one ACID transaction) ----------
// 6.2 / 6.3  borrow_resource(2,1003): only a PHYSICAL and AVAILABLE resource matches, so otherwise nothing happens
MATCH (u:User {user_id:2}), (r:Resource {resource_id:1003, resource_type:'physical', status:'available'})
MERGE (c:Counter {name:'borrow'}) ON CREATE SET c.value = 0
SET c.value = c.value + 1, r.status = 'borrowed'
CREATE (b:Borrow {borrow_id:c.value, borrow_date:date(), due_date:date() + duration({days:7}), borrow_status:'borrowed'})
CREATE (u)-[:BORROWED]->(b)-[:FOR_RESOURCE]->(r)
RETURN b.borrow_id, b.borrow_date, b.due_date;

// 6.4 display borrow record
MATCH (u:User)-[:BORROWED]->(b:Borrow)-[:FOR_RESOURCE]->(r:Resource)
RETURN b.borrow_id, u.name, r.title, b.borrow_date, b.due_date, b.borrow_status;

// 6.6 / 6.8  return_resource(1,'Good condition') with the fine rule of calculate_fine (Rs.10 per late day)
MATCH (b:Borrow {borrow_id:1, borrow_status:'borrowed'})-[:FOR_RESOURCE]->(r:Resource)
MERGE (c:Counter {name:'return'}) ON CREATE SET c.value = 0
SET c.value = c.value + 1
WITH b, r, c, duration.inDays(b.due_date, date()).days AS late
WITH b, r, c, CASE WHEN late > 0 THEN late * 10.0 ELSE 0.0 END AS fine
SET b.borrow_status = 'returned', r.status = 'available'
CREATE (rl:ReturnLog {return_id:c.value, return_date:date(), fine_amount:fine, resource_condition:'Good condition', borrow_id:b.borrow_id})
CREATE (b)-[:HAS_RETURN]->(rl)
RETURN rl.return_id, rl.return_date, rl.fine_amount;

// 6.5 calculate_fine as a query (shows the fine for every returned borrow)
MATCH (b:Borrow)-[:HAS_RETURN]->(rl:ReturnLog)
WITH b, rl, duration.inDays(b.due_date, rl.return_date).days AS late
RETURN b.borrow_id, CASE WHEN late > 0 THEN late * 10 ELSE 0 END AS fine;

// ---------- 7. "CURSOR" = aggregation: average rating per resource ----------
MATCH (r:Resource)
OPTIONAL MATCH (:User)-[x:RATED]->(r)
RETURN r.title AS title, round(coalesce(avg(x.rating_value), 0) * 100) / 100 AS avg_rating
ORDER BY title;

// ---------- 8. "TRIGGERS" ----------
// Neo4j Community has no native triggers, so the two triggers are implemented in the backend (server.js):
//   8.1 trg_resource_date : upload_date is set by date() when a resource node is created
//   8.2 trg_check_borrow  : the borrow transaction refuses digital or already-borrowed resources (HTTP 422 / 409)
// Demo of 8.2 - this matches NOTHING because 1001 is digital, so no borrow is created:
MATCH (u:User {user_id:1}), (r:Resource {resource_id:1001, resource_type:'physical', status:'available'})
RETURN count(r) AS borrowable_matches;

// ---------- 9. OBJECT VERIFICATION ----------
SHOW CONSTRAINTS;
SHOW INDEXES;
CALL db.labels();
CALL db.relationshipTypes();

// ---------- 10. FINAL VERIFICATION ----------
// 10.1 all "tables" (labels) with row counts
MATCH (n) WHERE NOT n:Counter RETURN labels(n)[0] AS label, count(*) AS total ORDER BY label;

// 10.2 final resource details
MATCH (o:User)-[:OWNS]->(r:Resource)-[:BELONGS_TO]->(s:Subject)
RETURN r.resource_id, r.title, r.resource_type, r.status, r.download_count, s.subject_name, o.name AS uploaded_by
ORDER BY r.resource_id;

// 10.3 the whole graph as a picture (great for the viva!)
MATCH p = (n)-[]->(m) WHERE NOT n:Counter AND NOT m:Counter RETURN p LIMIT 100;
