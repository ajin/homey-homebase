import Homey from 'homey';

class HomebaseApp extends Homey.App {
  async onInit(): Promise<void> {
    this.log('Homebase started (unofficial, local control only)');
    // Homey warns before it stops an app for using too much memory or CPU; keep a trace of it.
    this.homey.on('memwarn', (data: { count: number; limit: number }) => this.error(`Memory warning ${data.count}/${data.limit}`));
    this.homey.on('cpuwarn', (data: { count: number; limit: number }) => this.error(`CPU warning ${data.count}/${data.limit}`));
  }
}

export = HomebaseApp;
