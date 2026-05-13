-- =====================================================
-- 부품 불량 이력 관리 시스템 - Supabase 초기화 SQL
-- Supabase SQL Editor에서 실행하세요
-- =====================================================

-- 1. 테이블 생성
-- =====================================================

CREATE TABLE IF NOT EXISTS public.defect_type_codes (
  id        SERIAL PRIMARY KEY,
  code      VARCHAR(10)  UNIQUE NOT NULL,
  name      VARCHAR(100) NOT NULL,
  category  VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  use_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.parts (
  id             SERIAL PRIMARY KEY,
  part_no        VARCHAR(50)  UNIQUE NOT NULL,
  part_name      VARCHAR(200) NOT NULL,
  supplier       VARCHAR(100),
  category       VARCHAR(100),
  grade          VARCHAR(2) DEFAULT 'A',
  last_incoming  DATE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.inspections (
  id            SERIAL PRIMARY KEY,
  part_id       INTEGER REFERENCES public.parts(id) ON DELETE CASCADE,
  lot_no        VARCHAR(50),
  incoming_date DATE,
  incoming_qty  INTEGER DEFAULT 0,
  inspect_qty   INTEGER DEFAULT 0,
  defect_qty    INTEGER DEFAULT 0,
  defect_rate   NUMERIC(5,2) DEFAULT 0,
  result        VARCHAR(20),
  inspector     VARCHAR(100),
  notes         TEXT,
  action        VARCHAR(50),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.defect_details (
  id               SERIAL PRIMARY KEY,
  inspection_id    INTEGER REFERENCES public.inspections(id) ON DELETE CASCADE,
  defect_type_name VARCHAR(100),
  defect_count     INTEGER DEFAULT 1,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- users (로그인 계정)
CREATE TABLE IF NOT EXISTS public.users (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  role       VARCHAR(50),
  username   VARCHAR(50) UNIQUE NOT NULL,
  password   VARCHAR(100) NOT NULL,
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. RLS 비활성화 (내부 시스템용)
-- =====================================================
ALTER TABLE public.defect_type_codes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.parts             DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspections       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.defect_details    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.users             DISABLE ROW LEVEL SECURITY;

-- 3. 기본 계정 등록
-- =====================================================
INSERT INTO public.users (name, role, username, password) VALUES
('김민수', '입고 검사자',   'mskim',  '1234'),
('이영희', '품질 관리자',   'yhlee',  '1234'),
('박정훈', '입고 검사자',   'jhpark', '1234'),
('최수진', '구매/조달',     'sjchoi', '1234'),
('관리자', '시스템 관리자', 'admin',  'admin1234')
ON CONFLICT (username) DO NOTHING;
