-- Demo employees (Arnita, Ni Ni, Zhengrui). Safe to re-run.
-- Requires migration pa_employee_demos_arnita_nini_zhengrui (pa_create_demo_employee).

select public.pa_create_demo_employee('arnita@mdesigns.test', 'DemoEmployee2026!', 'Arnita Serri', 'Arnita Serri');
select public.pa_create_demo_employee('nini@mdesigns.test', 'DemoEmployee2026!', 'Ni Ni', 'Ni Ni');
select public.pa_create_demo_employee('zhengrui@mdesigns.test', 'DemoEmployee2026!', 'Zhengrui He', 'Zhengrui He');
