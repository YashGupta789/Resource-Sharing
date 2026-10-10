'use strict';
// Loads the sample data from the project document (sections 2.1 - 2.7).
const { driver, transaction, ensureSchema } = require('./db');
const { hashPassword } = require('./util');

const departments = [
  { id: 1, name: 'CSE', description: 'Computer Science and Engineering' },
  { id: 2, name: 'ECE', description: 'Electronics and Communication Engineering' },
  { id: 3, name: 'MECH', description: 'Mechanical Engineering' },
];

const subjects = [
  { id: 101, name: 'Database Management Systems', semester: 4, dept: 1 },
  { id: 102, name: 'Operating Systems', semester: 4, dept: 1 },
  { id: 103, name: 'Computer Networks', semester: 5, dept: 1 },
  { id: 104, name: 'Digital Electronics', semester: 4, dept: 2 },
  { id: 105, name: 'Engineering Mechanics', semester: 3, dept: 3 },
];

const users = [
  { id: 1, name: 'Rahul', email: 'rahul@gmail.com', password: 'rahul123', phone: '9876543210', year: 2, dept: 1 },
  { id: 2, name: 'Priya', email: 'priya@gmail.com', password: 'priya123', phone: '9876543211', year: 2, dept: 1 },
  { id: 3, name: 'Arjun', email: 'arjun@gmail.com', password: 'arjun123', phone: '9876543212', year: 3, dept: 1 },
  { id: 4, name: 'Sneha', email: 'sneha@gmail.com', password: 'sneha123', phone: '9876543213', year: 2, dept: 2 },
].map((u) => ({ ...u, password: hashPassword(u.password) }));

const resources = [
  { id: 1001, title: 'DBMS Unit 1 Notes', description: 'Complete Unit 1 notes', type: 'digital', category: 'Notes', file_url: 'dbms_unit1.pdf', subject: 101, owner: 1 },
  { id: 1002, title: 'DBMS Lab Manual', description: 'DBMS laboratory exercises', type: 'digital', category: 'Lab Manual', file_url: 'dbms_lab.pdf', subject: 101, owner: 2 },
  { id: 1003, title: 'Operating Systems Book', description: 'OS reference book', type: 'physical', category: 'Book', file_url: null, subject: 102, owner: 3 },
  { id: 1004, title: 'Computer Networks PYQs', description: 'Previous year question papers', type: 'digital', category: 'Question Paper', file_url: 'cn_pyq.pdf', subject: 103, owner: 1 },
];

const ratings = [
  { id: 1, value: 5, review: 'Very useful notes', user: 2, resource: 1001 },
  { id: 2, value: 4, review: 'Good explanation', user: 3, resource: 1001 },
  { id: 3, value: 5, review: 'Helpful for lab preparation', user: 1, resource: 1002 },
];

const favorites = [
  { id: 1, user: 2, resource: 1001 },
  { id: 2, user: 3, resource: 1001 },
  { id: 3, user: 1, resource: 1004 },
];

const reports = [
  { id: 1, reason: 'File contains incorrect material', status: 'pending', user: 2, resource: 1004 },
];

// Replacement for Oracle sequences (borrow_seq, return_seq) + ids for every other entity.
// Each counter holds the LAST used id.
const counters = [
  { name: 'department', value: 3 },
  { name: 'subject', value: 105 },
  { name: 'user', value: 4 },
  { name: 'resource', value: 1004 },
  { name: 'borrow', value: 0 },
  { name: 'return', value: 0 },
  { name: 'rating', value: 3 },
  { name: 'favorite', value: 3 },
  { name: 'report', value: 1 },
];

async function seed() {
  await transaction(async (run) => {
    await run('MATCH (n) DETACH DELETE n'); // wipe old demo data (constraints are kept)

    await run('UNWIND $rows AS row CREATE (:Counter {name: row.name, value: toInteger(row.value)})', { rows: counters });

    await run(
      `UNWIND $rows AS row
       CREATE (:Department {department_id: toInteger(row.id), department_name: row.name, description: row.description})`,
      { rows: departments }
    );

    await run(
      `UNWIND $rows AS row
       MATCH (d:Department {department_id: toInteger(row.dept)})
       CREATE (:Subject {subject_id: toInteger(row.id), subject_name: row.name, semester: toInteger(row.semester)})-[:IN_DEPARTMENT]->(d)`,
      { rows: subjects }
    );

    await run(
      `UNWIND $rows AS row
       MATCH (d:Department {department_id: toInteger(row.dept)})
       CREATE (:User {user_id: toInteger(row.id), name: row.name, email: row.email, user_password: row.password,
                      phone: row.phone, student_year: toInteger(row.year)})-[:MEMBER_OF]->(d)`,
      { rows: users }
    );

    await run(
      `UNWIND $rows AS row
       MATCH (s:Subject {subject_id: toInteger(row.subject)}), (o:User {user_id: toInteger(row.owner)})
       CREATE (r:Resource {resource_id: toInteger(row.id), title: row.title, description: row.description,
                           resource_type: row.type, category: row.category, upload_date: date(),
                           file_url: row.file_url, status: 'available', download_count: 0})
       CREATE (o)-[:OWNS]->(r), (r)-[:BELONGS_TO]->(s)`,
      { rows: resources }
    );

    await run(
      `UNWIND $rows AS row
       MATCH (u:User {user_id: toInteger(row.user)}), (r:Resource {resource_id: toInteger(row.resource)})
       CREATE (u)-[:RATED {rating_id: toInteger(row.id), rating_value: toInteger(row.value),
                           review: row.review, rating_date: date()}]->(r)`,
      { rows: ratings }
    );

    await run(
      `UNWIND $rows AS row
       MATCH (u:User {user_id: toInteger(row.user)}), (r:Resource {resource_id: toInteger(row.resource)})
       CREATE (u)-[:FAVORITED {favorite_id: toInteger(row.id), added_date: date()}]->(r)`,
      { rows: favorites }
    );

    await run(
      `UNWIND $rows AS row
       MATCH (u:User {user_id: toInteger(row.user)}), (r:Resource {resource_id: toInteger(row.resource)})
       CREATE (u)-[:REPORTED]->(:Report {report_id: toInteger(row.id), reason: row.reason,
                                          status: row.status, report_date: date()})-[:ABOUT]->(r)`,
      { rows: reports }
    );
  });
}

module.exports = { seed };

// `npm run seed` (or: docker compose exec api npm run seed)
if (require.main === module) {
  (async () => {
    await ensureSchema();
    await seed();
    console.log('Sample data loaded.');
    await driver.close();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
