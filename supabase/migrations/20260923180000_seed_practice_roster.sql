-- Canonical US / Pak practice roster (filters). Safe to re-run.
insert into public.pa_employee_roster (team, employee) values
  ('US Team', 'Avery Cobe'),
  ('US Team', 'Arnita Serri'),
  ('US Team', 'Malika Junaid'),
  ('US Team', 'Ni Ni'),
  ('US Team', 'Sadia Puri'),
  ('US Team', 'Maria Abreu'),
  ('US Team', 'Richard Hugi'),
  ('US Team', 'Swaroopa Dugani'),
  ('US Team', 'Priya Arora'),
  ('US Team', 'Laura Bush'),
  ('US Team', 'Zachary Rilla'),
  ('US Team', 'Zhengrui He'),
  ('Pak Team', 'Mahnoor Khalid'),
  ('Pak Team', 'Fizza Iqbal'),
  ('Pak Team', 'Aiman Rehman'),
  ('Pak Team', 'Aamir Umer'),
  ('Pak Team', 'Jawwad Naseer'),
  ('Pak Team', 'Haniya Madni'),
  ('Pak Team', 'Rehan Siddiqui'),
  ('Pak Team', 'Muhammad Junaid')
on conflict (team, employee) do nothing;
