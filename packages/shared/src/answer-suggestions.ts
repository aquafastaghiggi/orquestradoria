/**
 * Sugestões de resposta para as perguntas que o Developer costuma fazer. O usuário vê a sugestão no campo de resposta e edita
 * antes de enviar; nada é enviado automaticamente.
 */
const DEMO_ACCOUNTS=' Contas de demonstração: demo / demo123 e motorista / motorista123 (troque depois, se quiser).';

const RULES:Array<{test:RegExp;answer:(question:string)=>string}>=[
  {
    test:/controle_notas|banco real|diretamente em|\broot\b|outros? bancos?|produ[cç][aã]o|pol[ií]tica[^.]*banco/i,
    answer:question=>`Não crie nada no banco real. Entregue um script idempotente (lendo ORQ_DB_* e usando os padrões do projeto como alternativa), rode-o no banco de teste para validar e me diga o comando exato para eu rodar no banco real.${/conta|usu[aá]rio|motorista|demo/i.test(question)?DEMO_ACCOUNTS:''}`
  },
  {
    test:/curl|https?:|127\.0\.0\.1|localhost|php -s|servidor|requisi[cç][aã]o/i,
    answer:()=>'Pode usar curl contra http://127.0.0.1:<porta> (liberado só para o próprio computador) ou um script PHP/Node. Suba "php -S 127.0.0.1:8099 -t ." em segundo plano e encerre ao terminar.'
  },
  {
    test:/senha|password/i,
    answer:()=>`Use motorista123 para o motorista e demo123 para o demo (só demonstração).`
  }
];

/** Sugestão pronta para uma pergunta conhecida, ou texto vazio quando não há regra (o usuário responde). */
export function suggestAnswer(question:string):string{
  const text=String(question||'');
  for(const rule of RULES)if(rule.test.test(text))return rule.answer(text);
  return '';
}