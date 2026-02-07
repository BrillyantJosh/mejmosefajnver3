import Database from 'better-sqlite3';

export function seedData(db: Database.Database): void {
  // Only seed if tables are empty

  // Seed wallet_types
  const walletCount = db.prepare('SELECT COUNT(*) as count FROM wallet_types').get() as any;
  if (walletCount.count === 0) {
    const insertWalletType = db.prepare(`
      INSERT INTO wallet_types (id, name, description, is_active, display_order)
      VALUES (lower(hex(randomblob(16))), ?, ?, 1, ?)
    `);

    const walletTypes = [
      ['LANA Core Wallet', 'Official LANA desktop wallet', 1],
      ['LANA Mobile Wallet', 'Mobile wallet for iOS and Android', 2],
      ['LANA Web Wallet', 'Browser-based wallet', 3],
      ['LANA Paper Wallet', 'Offline paper wallet for cold storage', 4],
    ];

    const insertMany = db.transaction((types: any[]) => {
      for (const type of types) {
        insertWalletType.run(type[0], type[1], type[2]);
      }
    });

    insertMany(walletTypes);
    console.log('Seeded wallet_types with default values');
  }

  // Seed default app_settings if empty
  const settingsCount = db.prepare('SELECT COUNT(*) as count FROM app_settings').get() as any;
  if (settingsCount.count === 0) {
    const insertSetting = db.prepare(`
      INSERT INTO app_settings (id, key, value)
      VALUES (lower(hex(randomblob(16))), ?, ?)
    `);

    const defaultSettings = [
      ['app_name', JSON.stringify('MejMoSeFajn')],
      ['theme_colors', JSON.stringify({ primary: '#8B5CF6', secondary: '#D946EF' })],
      ['default_rooms', JSON.stringify([])],
    ];

    const insertMany = db.transaction((settings: any[]) => {
      for (const setting of settings) {
        insertSetting.run(setting[0], setting[1]);
      }
    });

    insertMany(defaultSettings);
    console.log('Seeded app_settings with default values');
  }

  // Seed kind_38888 system parameters if empty
  // NOTE: These are placeholder values - the real values should be synced from Lana relays!
  const kind38888Count = db.prepare('SELECT COUNT(*) as count FROM kind_38888').get() as any;
  if (kind38888Count.count === 0) {
    // Official Lana relays - ONLY these should be used!
    const defaultRelays = [
      'wss://relay.lanavault.space',
      'wss://relay.lanacoin-eternity.com'
    ];

    const defaultElectrumServers = [
      { host: 'electrum1.lanacoin.com', port: '5097' },
      { host: 'electrum2.lanacoin.com', port: '5097' },
      { host: 'electrum3.lanacoin.com', port: '5097' }
    ];

    const defaultExchangeRates = {
      EUR: 0.00001,
      USD: 0.000011,
      GBP: 0.0000085
    };

    const defaultTrustedSigners = {
      '9eb71bf1e9c3189c78800e4c3831c1c1a93ab43b61118818c32e4490891a35b3': ['system']
    };

    // Create a mock raw event
    const rawEvent = JSON.stringify({
      id: 'local_seed_event',
      kind: 38888,
      created_at: Math.floor(Date.now() / 1000),
      pubkey: '9eb71bf1e9c3189c78800e4c3831c1c1a93ab43b61118818c32e4490891a35b3',
      content: '',
      tags: [],
      sig: 'local_seed'
    });

    db.prepare(`
      INSERT INTO kind_38888 (
        id, event_id, pubkey, created_at, relays, electrum_servers,
        exchange_rates, split, version, valid_from, trusted_signers, raw_event
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'seed_kind_38888',
      'local_seed_event_' + Date.now(),
      '9eb71bf1e9c3189c78800e4c3831c1c1a93ab43b61118818c32e4490891a35b3',
      Math.floor(Date.now() / 1000),
      JSON.stringify(defaultRelays),
      JSON.stringify(defaultElectrumServers),
      JSON.stringify(defaultExchangeRates),
      '0.001', // split
      '1.0.0', // version
      Math.floor(Date.now() / 1000), // valid_from
      JSON.stringify(defaultTrustedSigners),
      rawEvent
    );

    console.log('Seeded kind_38888 with default system parameters');
  }
}
