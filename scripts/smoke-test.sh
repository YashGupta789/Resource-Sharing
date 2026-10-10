#!/usr/bin/env bash
# Quick end-to-end check of the API. Run after `docker compose up --build`.
# Usage: bash scripts/smoke-test.sh   (needs curl)
B=${1:-http://localhost:3000}
j() { curl -s -X "$1" "$B$2" -H 'Content-Type: application/json' ${3:+-d "$3"}; echo; }
echo "== health";                      j GET  /api/health
echo "== reset sample data";           j POST /api/reset
echo "== available physical items";    j GET  "/api/resources?type=physical&status=available"
echo "== Priya (2) borrows book 1003"; j POST /api/borrow '{"user_id":2,"resource_id":1003}'
echo "== borrow again (expect 409)";   j POST /api/borrow '{"user_id":1,"resource_id":1003}'
echo "== borrow digital (expect 422)"; j POST /api/borrow '{"user_id":1,"resource_id":1001}'
echo "== return 12 days late -> fine"; j POST /api/return '{"borrow_id":1,"resource_condition":"Good","return_date":"'$(date -d '+12 days' +%F 2>/dev/null || date -v+12d +%F)'"}'
echo "== rating 6 (expect 400)";       j POST /api/ratings '{"user_id":1,"resource_id":1001,"rating_value":6}'
echo "== duplicate rating (409)";      j POST /api/ratings '{"user_id":2,"resource_id":1001,"rating_value":3}'
echo "== download +1";                 j POST /api/resources/1001/download
echo "== average ratings";             j GET  /api/ratings/average
echo "== resolve report 1";            j PATCH /api/reports/1 '{"status":"resolved"}'
echo "== stats";                       j GET  /api/stats
