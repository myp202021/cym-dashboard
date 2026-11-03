-- Estado y datos del lead por conversación de Instagram o Messenger (agente CyM). Solo service role.
create table if not exists public.meta_conversaciones (
  cliente text not null default 'cym',
  plataforma text not null,
  contacto_id text not null,
  nodo text,
  estado text not null default 'abierto', -- abierto | completo | humano | alias
  intentos int not null default 0,
  datos jsonb not null default '{}',      -- nombre, telefono, codigo, tema, comuna, tipo, operacion, consulta, director
  ultimo_bot text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  primary key (cliente, plataforma, contacto_id)
);
alter table public.meta_conversaciones enable row level security;
