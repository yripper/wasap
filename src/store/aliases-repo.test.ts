import { beforeEach, describe, expect, it } from 'vitest';
import { AliasesRepo } from './aliases-repo.js';
import { ContactsRepo } from './contacts-repo.js';
import { openDb } from './db.js';

describe('AliasesRepo', () => {
  let repo: AliasesRepo;
  beforeEach(() => {
    repo = new AliasesRepo(openDb(':memory:'));
  });

  it('resolves an unknown jid to itself', () => {
    expect(repo.resolve('111@s.whatsapp.net')).toBe('111@s.whatsapp.net');
  });

  it('resolves an alias to its canonical jid', () => {
    repo.add('222@lid', '111@s.whatsapp.net');
    expect(repo.resolve('222@lid')).toBe('111@s.whatsapp.net');
  });

  it('repoint moves aliases and keeps the old canonical resolving', () => {
    repo.add('222@lid', '333@s.whatsapp.net');
    repo.repoint('333@s.whatsapp.net', '111@s.whatsapp.net');
    expect(repo.resolve('222@lid')).toBe('111@s.whatsapp.net');
    expect(repo.resolve('333@s.whatsapp.net')).toBe('111@s.whatsapp.net');
  });
});

describe('ContactsRepo', () => {
  it('upserts and reads names', () => {
    const repo = new ContactsRepo(openDb(':memory:'));
    repo.upsertMany([{ jid: '111@s.whatsapp.net', name: 'Alice' }]);
    repo.upsertMany([{ jid: '111@s.whatsapp.net', name: 'Alicia' }]);
    expect(repo.name('111@s.whatsapp.net')).toBe('Alicia');
    expect(repo.name('999@s.whatsapp.net')).toBeNull();
  });
});
