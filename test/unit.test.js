// Testes das regras que não dependem de internet:  npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { analisarBoleto, mod10, mod11Bancario } from '../src/boleto.js';
import { cnpjValido } from '../src/cnpj.js';
import { cpfValido, extrairEntidades, extrairChavePix } from '../src/entities.js';
import { analisarDominio, dominioRegistravel } from '../src/brandCheck.js';
import { analisarTexto } from '../src/patterns.js';
import { detectarIntencaoDeIncidente } from '../src/incident.js';

function gerarLinha({ banco = '341', fator = '1500', valor = '0000012345', livre = '1234567890123456789012345' } = {}) {
  const dv = mod11Bancario(`${banco}9${fator}${valor}${livre}`);
  const c1 = `${banco}9${livre.slice(0, 5)}`;
  const c2 = livre.slice(5, 15);
  const c3 = livre.slice(15, 25);
  return `${c1}${mod10(c1)}${c2}${mod10(c2)}${c3}${mod10(c3)}${dv}${fator}${valor}`;
}

test('boleto válido: banco, valor e vencimento', async () => {
  const r = await analisarBoleto(gerarLinha());
  assert.equal(r.valido, true);
  assert.equal(r.banco, 'Itaú Unibanco');
  assert.equal(r.valor, 123.45);
  assert.equal(r.vencimento.toISOString().slice(0, 10), '2026-07-07');
});

test('boleto adulterado: dígito verificador não bate', async () => {
  const linha = gerarLinha();
  const adulterada = `${linha.slice(0, 12)}${(Number(linha[12]) + 1) % 10}${linha.slice(13)}`;
  const r = await analisarBoleto(adulterada);
  assert.equal(r.valido, false);
  assert.equal(r.nivel, 'alto');
});

test('boleto é achado no meio do texto, com pontos e espaços', () => {
  const l = gerarLinha({ fator: '9000' });
  const fmt = `${l.slice(0, 5)}.${l.slice(5, 10)} ${l.slice(10, 15)}.${l.slice(15, 21)} ${l.slice(21, 26)}.${l.slice(26, 32)} ${l[32]} ${l.slice(33)}`;
  const e = extrairEntidades(`paga esse boleto: ${fmt} até amanhã`);
  assert.equal(e.linha, l);
  assert.equal(e.telefones.length, 0);
});

test('CPF e CNPJ: dígitos verificadores', () => {
  assert.equal(cnpjValido('11.222.333/0001-81'), true);
  assert.equal(cnpjValido('11.222.333/0001-82'), false);
  assert.equal(cpfValido('529.982.247-25'), true);
  assert.equal(cpfValido('529.982.247-26'), false);
});

test('marca falsa e letras trocadas', () => {
  const r = analisarDominio('banc0-itau-premios.com');
  assert.ok(r.pontos >= 55);
  assert.match(r.motivos.join(' '), /Itaú/);
  assert.equal(analisarDominio('ltau-seguranca.com').motivos.some((m) => /números ou caracteres/.test(m)), true);
  assert.equal(analisarDominio('www.itau.com.br').pontos, 0);
  assert.equal(analisarDominio('receitasdebolo.com.br').pontos, 0);
  assert.ok(analisarDominio('gov-br-regulariza.online').pontos >= 50);
  assert.equal(dominioRegistravel('app.banco.com.br'), 'banco.com.br');
});

test('padrões de golpe no texto', () => {
  const parente = analisarTexto('Oi mãe, troquei de número. Consegue me fazer um Pix urgente de R$ 1.800?');
  assert.equal(parente.nivel, 'alto');
  assert.match(parente.golpe, /falso parente/);
  assert.equal(analisarTexto('O almoço de domingo vai ser na casa da vó, às 13h. Você leva a sobremesa?').nivel, 'baixo');
  assert.match(analisarTexto('Central de Segurança: informe o código que enviamos por SMS').golpe, /falsa central/);
});

test('chave Pix e incidente', () => {
  assert.deepEqual(extrairChavePix('chave pix: Fulano@Gmail.com'), { tipo: 'email', chave: 'fulano@gmail.com' });
  assert.equal(extrairChavePix('pix 11 98765-4321').tipo, 'telefone');
  assert.equal(detectarIntencaoDeIncidente('caí no golpe, fiz um pix'), true);
  assert.equal(detectarIntencaoDeIncidente('ainda não cliquei no link'), false);
});
