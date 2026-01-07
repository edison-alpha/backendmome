#!/bin/bash

echo "🧪 Testing Backend API Locally"
echo "================================"
echo ""

BASE_URL="http://localhost:3000"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Test 1: Health Check
echo "1️⃣  Testing Health Check..."
response=$(curl -s -w "\n%{http_code}" $BASE_URL/health)
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✅ Health check passed${NC}"
    echo "   Response: $body"
else
    echo -e "${RED}❌ Health check failed (HTTP $http_code)${NC}"
fi
echo ""

# Test 2: Global Activity
echo "2️⃣  Testing Global Activity..."
response=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/raffle-activity/global?limit=5")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✅ Global activity passed${NC}"
    echo "   Response: ${body:0:100}..."
else
    echo -e "${RED}❌ Global activity failed (HTTP $http_code)${NC}"
fi
echo ""

# Test 3: Cache Test (run twice)
echo "3️⃣  Testing Cache (2 requests)..."
echo "   First request (should be uncached):"
response1=$(curl -s "$BASE_URL/api/raffle-activity/global?limit=5")
cached1=$(echo "$response1" | grep -o '"cached":[^,}]*' | cut -d':' -f2)
echo "   Cached: $cached1"

sleep 1

echo "   Second request (should be cached):"
response2=$(curl -s "$BASE_URL/api/raffle-activity/global?limit=5")
cached2=$(echo "$response2" | grep -o '"cached":[^,}]*' | cut -d':' -f2)
echo "   Cached: $cached2"

if [ "$cached2" = "true" ]; then
    echo -e "${GREEN}✅ Cache working correctly${NC}"
else
    echo -e "${RED}⚠️  Cache might not be working${NC}"
fi
echo ""

# Test 4: Specific Raffle
echo "4️⃣  Testing Specific Raffle Activity..."
response=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/raffle-activity/0?limit=5")
http_code=$(echo "$response" | tail -n1)

if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✅ Specific raffle passed${NC}"
else
    echo -e "${RED}❌ Specific raffle failed (HTTP $http_code)${NC}"
fi
echo ""

echo "================================"
echo "✨ Testing complete!"
