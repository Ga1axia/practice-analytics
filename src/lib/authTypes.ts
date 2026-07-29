export type UserRole = 'admin' | 'employee' | 'customer';

export type Profile = {
  id: string;
  email: string;
  role: UserRole;
  display_name: string | null;
  employee_name: string | null;
  client_name: string | null;
};
