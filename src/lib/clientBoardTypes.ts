export type ClientMessage = {
  id: string;
  project_key: string;
  client_name: string;
  author_role: 'staff' | 'customer';
  author_name: string | null;
  body: string;
  created_at: string;
  created_by: string | null;
};

export type ClientBoardProject = {
  projectKey: string;
  title: string;
  clientName: string;
  manager: string | null;
  status: string | null;
  city: string | null;
  phase: string | null;
  contract?: number;
  billed?: number;
  spent?: number;
  ar?: number;
  retainerPaid?: number;
  retainerBalance?: number;
  additionalFee?: number;
};

export type ClientBoardOption = {
  projectKey: string;
  title: string;
  status: string | null;
};

export type ClientBoardMode = 'customer' | 'pm';
