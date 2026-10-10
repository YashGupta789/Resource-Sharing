'use strict';
const neo4j = require('neo4j-driver');

const URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const USER = process.env.NEO4J_USER || 'neo4j';
const PASSWORD = process.env.NEO4J_PASSWORD || 'resource123';

// disableLosslessIntegers => Neo4j integers come back as normal JS numbers
const driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD), {
  disableLosslessIntegers: true,
});

async function withSession(mode, fn) {
  const session = driver.session({ defaultAccessMode: mode });
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

// Single read query -> array of plain objects
function read(cypher, params = {}) {
  return withSession(neo4j.session.READ, (s) =>
    s.executeRead(async (tx) => (await tx.run(cypher, params)).records.map((r) => r.toObject()))
  );
}

// Single write query (auto-committed in its own transaction)
function write(cypher, params = {}) {
  return withSession(neo4j.session.WRITE, (s) =>
    s.executeWrite(async (tx) => (await tx.run(cypher, params)).records.map((r) => r.toObject()))
  );
}

// Multi-statement ACID transaction. If fn throws, EVERYTHING is rolled back.
// Usage: transaction(async (run) => { await run(cypher1, p1); await run(cypher2, p2); })
function transaction(fn) {
  return withSession(neo4j.session.WRITE, (s) =>
    s.executeWrite((tx) =>
      fn(async (cypher, params = {}) => (await tx.run(cypher, params)).records.map((r) => r.toObject()))
    )
  );
}

// Equivalent of the PRIMARY KEY / UNIQUE parts of the CREATE TABLE statements in the SQL document.
// CHECK / NOT NULL / FOREIGN KEY rules are enforced in server.js (validation + MATCH before CREATE).
const SCHEMA = [
  'CREATE CONSTRAINT department_id_unique IF NOT EXISTS FOR (n:Department) REQUIRE n.department_id IS UNIQUE',
  'CREATE CONSTRAINT department_name_unique IF NOT EXISTS FOR (n:Department) REQUIRE n.department_name IS UNIQUE',
  'CREATE CONSTRAINT subject_id_unique IF NOT EXISTS FOR (n:Subject) REQUIRE n.subject_id IS UNIQUE',
  'CREATE CONSTRAINT user_id_unique IF NOT EXISTS FOR (n:User) REQUIRE n.user_id IS UNIQUE',
  'CREATE CONSTRAINT user_email_unique IF NOT EXISTS FOR (n:User) REQUIRE n.email IS UNIQUE',
  'CREATE CONSTRAINT resource_id_unique IF NOT EXISTS FOR (n:Resource) REQUIRE n.resource_id IS UNIQUE',
  'CREATE CONSTRAINT borrow_id_unique IF NOT EXISTS FOR (n:Borrow) REQUIRE n.borrow_id IS UNIQUE',
  'CREATE CONSTRAINT return_id_unique IF NOT EXISTS FOR (n:ReturnLog) REQUIRE n.return_id IS UNIQUE',
  'CREATE CONSTRAINT return_borrow_unique IF NOT EXISTS FOR (n:ReturnLog) REQUIRE n.borrow_id IS UNIQUE',
  'CREATE CONSTRAINT report_id_unique IF NOT EXISTS FOR (n:Report) REQUIRE n.report_id IS UNIQUE',
  'CREATE CONSTRAINT counter_name_unique IF NOT EXISTS FOR (n:Counter) REQUIRE n.name IS UNIQUE',
];

async function ensureSchema() {
  for (const statement of SCHEMA) await write(statement);
}

module.exports = { driver, read, write, transaction, ensureSchema };
