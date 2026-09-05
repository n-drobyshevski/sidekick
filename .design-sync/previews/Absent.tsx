import { Absent } from "@wiz-sidekick/design-system";

export const InContext = () => (
  <table className="data" style={{ width: 420 }}>
    <thead>
      <tr><th>Repository</th><th>Last scan</th><th>Secrets</th></tr>
    </thead>
    <tbody>
      <tr><td>payments-api</td><td>2 hours ago</td><td>12</td></tr>
      <tr><td>ledger-svc</td><td><Absent /></td><td><Absent /></td></tr>
      <tr><td>report-gen</td><td>6 days ago</td><td>0</td></tr>
    </tbody>
  </table>
);
