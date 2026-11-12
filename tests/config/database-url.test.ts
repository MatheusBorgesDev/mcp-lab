import { inspect } from 'node:util'
import { describe, expect, it } from 'vitest'
import { readDatabaseUrl } from '../../server/db/client.js'

// A malformed DATABASE_URL must fail with a clear message instead of letting the driver fall back to
// localhost:5432 (seen in production as a misleading ECONNREFUSED 127.0.0.1:5432).
describe('readDatabaseUrl', () => {
  it.each([
    ['the Supabase transaction pooler', 'postgresql://postgres.ref:abc123@aws-1-sa-east-1.pooler.supabase.com:6543/postgres'],
    ['the local Supabase', 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'],
    ['the postgres:// scheme', 'postgres://user:pw@db.example.com:5432/app'],
  ])('accepts %s', (_label, url) => {
    expect(readDatabaseUrl(url)).toBe(url)
  })

  it('trims a pasted trailing newline', () => {
    expect(readDatabaseUrl('postgresql://u:pw@db.example.com:6543/postgres\n')).toBe(
      'postgresql://u:pw@db.example.com:6543/postgres',
    )
  })

  it.each([undefined, '', '   '])('reports %j as not set', (value) => {
    expect(() => readDatabaseUrl(value)).toThrow('DATABASE_URL is not set.')
  })

  it.each([
    ['two characters', 'ab'],
    ['a password alone', 'abc123'],
    ['another scheme', 'https://db.example.com/postgres'],
    ['no host', 'postgresql:///postgres'],
    ['a slash in the password', 'postgresql://postgres.ref:ab/c@aws-1-sa-east-1.pooler.supabase.com:6543/postgres'],
  ])('rejects %s', (_label, value) => {
    expect(() => readDatabaseUrl(value)).toThrow(/^DATABASE_URL is not a valid Postgres URL/)
  })

  it('never puts the value in the error', () => {
    const value = 'postgresql://postgres.ref:S3cretPw/x@aws-1-sa-east-1.pooler.supabase.com:6543/postgres'
    let thrown: unknown
    try {
      readDatabaseUrl(value)
    } catch (error) {
      thrown = error
    }

    expect((thrown as Error).message).toMatch(/^DATABASE_URL is not a valid Postgres URL/)
    expect(inspect(thrown, { showHidden: true, depth: 5 })).not.toContain('S3cretPw')
  })
})
