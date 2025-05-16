import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import contractAbi from './abi/Crowdfund.json';
import './CrowdfundDapp.css';

// --- FILL THIS IN ---
const CONTRACT_ADDRESS = '0x0685F3F7DDacBe9f9F468bDAB096F678A6c20FDB';
const TOKEN_ADDRESS = '0x33c5ABE7775F62aB6E20049bbc5d2eb29DEa1B21';

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)"
];

let contract = null;
let tokenContract = null;

function sameAddress(addressA, addressB) {
  return addressA.toLowerCase() == addressB.toLowerCase();
}

async function checkApproval(address, amount) {
  const allowance = await tokenContract.allowance(address, CONTRACT_ADDRESS);
  if (amount > allowance) {
    const diff = amount - allowance;
    const approveTx = await tokenContract.approve(CONTRACT_ADDRESS, diff);
    await approveTx.wait();
  }
}

export default function CrowdfundDapp() {
  // UI State
  const [account, setAccount] = useState('');
  const [goal, setGoal] = useState('');
  const [period, setPeriod] = useState('');
  const [projects, setProjects] = useState([]);
  const [fundAmount, setFundAmount] = useState({});
  const [proposalDetail, setProposalDetail] = useState({});
  const [proposalAmount, setProposalAmount] = useState({});
  const [reworkDetail, setReworkDetail] = useState({});
  const [reworkAmount, setReworkAmount] = useState({});
  const [delegatee, setDelegatee] = useState({});
  const [improvement, setImprovement] = useState({});
  const [reduceAmount, setReduceAmount] = useState({});
  const [voteType, setVoteType] = useState({});
  const [phaseInput, setPhaseInput] = useState({});
  const [reworkFlag, setReworkFlag] = useState({});
  const [funderInfo, setFunderInfo] = useState({});
  const [projectState, setProjectState] = useState({});
  const [votingPeriod, setVotingPeriod] = useState('');
  const [reworkPeriodInput, setReworkPeriodInput] = useState('');
  const [open, setOpen] = useState(false);
  const [canExpand, setCanExpand] = useState(false);

  const connectingRef = useRef(false);

  function formatTimestamp(ts) {
    if (!ts || ts === "0") return "-";
    // If ts is in seconds, multiply by 1000 for JS Date
    const date = new Date(Number(ts) * 1000);
    return date.toLocaleString(); // You can use toLocaleDateString() for just the date
  }

  function getMetaMaskProvider() {
    // EIP-5749: Multiple injected providers
    if (window.ethereum?.providers) {
      return window.ethereum.providers.find((p) => p.isMetaMask);
    }
    // Fallback: if only MetaMask is present
    if (window.ethereum?.isMetaMask) return window.ethereum;
    return null;
  }

  const handleToggle = (e, projectId) => {
    // If not allowed, prevent expanding
    if (!canExpand[projectId]) {
      e.preventDefault();
      return;
    }
    setOpen(e.target.open);
  };

  // Connect wallet and contract
  const connectWallet = useCallback(async () => {
    if (connectingRef.current) return; // Already connecting, ignore
    connectingRef.current = true;
    try {
      const metamaskProvider = getMetaMaskProvider();
      if (!metamaskProvider) {
        alert("MetaMask not detected. Please install or enable MetaMask, or disable other wallets.");
        return;
      }
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send('eth_requestAccounts', []);
      const signer = await provider.getSigner();
      const userAddress = await signer.getAddress();
      setAccount(userAddress);
      contract = new ethers.Contract(CONTRACT_ADDRESS, contractAbi.abi, signer);
      tokenContract = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, signer);
      fetchProjects(userAddress);
    } catch (e) {
      // Optionally handle/catch error here
    } finally {
      connectingRef.current = false; // Allow future connections
    }
  }, []);

  // Project functions
  const fetchProjects = useCallback(async (funderAddress) => {
    if (!contract) return;
    try {
      const nextId = Number(await contract.nextProjectId());
      const arr = [];
      for (let i = 0; i < nextId; i++) {
        const promises = [contract.projects(i)]
        if (funderAddress) promises.push(contract.getFunder(i, funderAddress))
        promises.push(contract.projectState(i))
        const res = await Promise.all(promises)
        if (funderAddress) setFunderInfo((prev) => ({ ...prev, [i]: res[1] }));
        // const completedFunding = Date.now() > Number(res[0].endTime) * 1000 && res[0].currentAmount > res[0].goal || res[2].threshold != 0;
        const inDevelopment = res[0].currentAmount > res[0].goal || res[2].threshold != 0;
        arr.push({
          id: i,
          creator: res[0].creator,
          goal: ethers.formatUnits(res[0].goal, 18),
          currentAmount: ethers.formatUnits(res[0].currentAmount, 18),
          funderCount: res[0].funderCount.toString(),
          startTime: res[0].startTime?.toString(),
          endTime: res[0].endTime?.toString(),
        });
        setCanExpand((prev) => ({ ...prev, [i]: inDevelopment }))
      }
      setProjects(arr);
    } catch (e) {
      alert(e.shortMessage || e.message); console.error(e);
    }
  }, []);

  const createProject = async () => {
    if (!goal || !period) return alert('Fill goal and period');
    try {
      const tx = await contract.createProject(ethers.parseUnits(goal, 18), period);
      await tx.wait();
      fetchProjects(account);
      setGoal("");
      setPeriod("");
    } catch (e) {
      alert(e.shortMessage || e.message); console.error(e);
    }
  };

  const fundProject = async (id) => {
    try {
      await checkApproval(account, ethers.parseUnits(fundAmount[id], 18))
      const tx = await contract.fundProject(id, ethers.parseUnits(fundAmount[id], 18));
      await tx.wait();
      fetchProjects(account);
      setFundAmount(fa => ({ ...fa, [id]: "" }))
    } catch (e) { alert(e.shortMessage || e.message); console.error(e); }
  };

  const reduceFunding = async (id) => {
    try {
      const tx = await contract.reduceFunding(id, ethers.parseUnits(reduceAmount[id], 18));
      await tx.wait();
      fetchProjects(account);
      setReduceAmount(ra => ({ ...ra, [id]: "" }))
    } catch (e) { alert(e.shortMessage || e.message); console.error(e); }
  };

  const claimFunds = async (id) => {
    try {
      const tx = await contract.claimFunds(id);
      await tx.wait();
      fetchProjects(account);
    } catch (e) { alert(e.shortMessage || e.message); console.error(e); }
  };

  const fundingRefund = async (id) => {
    try {
      const tx = await contract.fundingRefund(id);
      await tx.wait();
      fetchProjects(account);
    } catch (e) { alert(e.shortMessage || e.message); console.error(e); }
  };

  const developmentRefund = async (id) => {
    try {
      const tx = await contract.developmentRefund(id);
      await tx.wait();
      fetchProjects(account);
    } catch (e) { alert(e.shortMessage || e.message); console.error(e); }
  };

  const delegate = async (id) => {
    try {
      const tx = await contract.delegate(id, delegatee[id]);
      await tx.wait();
      fetchProjects(account);
    } catch (e) { alert(e.shortMessage || e.message); console.error(e); }
  };

  const getFunder = async (id) => {
    try {
      const res = await contract.getFunder(id, account);
      setFunderInfo((prev) => ({ ...prev, [id]: JSON.stringify(res, null, 2) }));
    } catch (e) { alert(e.shortMessage || e.message); console.error(e); }
  };

  const phaseProposal = async (id) => {
    try {
      const tx = await contract.phaseProposal(id, proposalAmount[id], proposalDetail[id]);
      await tx.wait();
      fetchProjects(account);
    } catch (e) { alert(e.shortMessage || e.message); console.error(e); }
  };

  const reworkProposal = async (id) => {
    try {
      const withdrawAmount = reworkAmount[id] ? ethers.parseUnits(reworkAmount[id], 18) : ethers.MaxUint256;
      const tx = await contract.reworkProposal(id, reworkDetail[id], withdrawAmount);
      await tx.wait();
      fetchProjects(account);
    } catch (e) { alert(e.shortMessage || e.message); console.error(e); }
  };

  const against = async (id) => {
    try {
      const tx = await contract.against(id, improvement[id]);
      await tx.wait();
      fetchProjects(account);
    } catch (e) { alert(e.shortMessage || e.message); console.error(e); }
  };

  const vote = async (id) => {
    try {
      const tx = await contract.vote(id, voteType[id]);
      await tx.wait();
      fetchProjects(account);
    } catch (e) { alert(e.shortMessage || e.message); console.error(e); }
  };

  const getPhase = async (id) => {
    try {
      const res = await contract.getPhase(id, phaseInput[id]);
      alert('Phase info: ' + JSON.stringify(res));
    } catch (e) { alert(e.shortMessage || e.message); console.error(e); }
  };

  const getProposal = async (id) => {
    try {
      const res = await contract.getProposal(id, phaseInput[id], !!reworkFlag[id]);
      alert('Proposal info: ' + JSON.stringify(res));
    } catch (e) { alert(e.shortMessage || e.message); console.error(e); }
  };

  const getVoter = async (id) => {
    try {
      const res = await contract.getVoter(id, phaseInput[id], account, !!reworkFlag[id]);
      alert('Voter info: ' + JSON.stringify(res));
    } catch (e) { alert(e.shortMessage || e.message); console.error(e); }
  };

  const getProjectState = async (id) => {
    try {
      const res = await contract.projectState(id);
      setProjectState((prev) => ({ ...prev, [id]: JSON.stringify(res, null, 2) }));
    } catch (e) { alert(e.shortMessage || e.message); console.error(e); }
  };

  const setPeriods = async () => {
    try {
      const tx = await contract.setPeriods(votingPeriod, reworkPeriodInput);
      await tx.wait();
      alert('Periods set');
    } catch (e) { alert(e.shortMessage || e.message); console.error(e); }
  };

  const getReworkPeriod = async () => {
    try {
      const res = await contract.reworkPeriod();
      alert('Rework period: ' + res.toString());
    } catch (e) { alert(e.shortMessage || e.message); console.error(e); }
  };

  const getVotingPeriod = async () => {
    try {
      const res = await contract.votingPeriod();
      alert('Voting period: ' + res.toString());
    } catch (e) { alert(e.shortMessage || e.message); console.error(e); }
  };

  const getNextProjectId = async () => {
    try {
      const res = await contract.nextProjectId();
      alert('Next projectId: ' + res.toString());
    } catch (e) { alert(e.shortMessage || e.message); console.error(e); }
  };

  const getTokenAddress = async () => {
    try {
      const res = await contract.tkn();
      alert('Token address: ' + res);
    } catch (e) { alert(e.shortMessage || e.message); console.error(e); }
  };

  // Auto-connect if MetaMask present
  useEffect(() => {
    if (window.ethereum) connectWallet();
    // eslint-disable-next-line
  }, [connectWallet]);

  // UI rendering
  return (
    <div className="crowdfund-app">
      <h1>Crowdfund DApp</h1>
      <button className="primary-btn" onClick={connectWallet}>
        {account ? `Connected: ${account.slice(0, 6)}...${account.slice(-4)}` : 'Connect MetaMask'}
      </button>
      {account && (
        <>
          <section className="card">
            <h2>Create Project</h2>
            <div className="form-row">
              <input value={goal} onChange={e => setGoal(e.target.value)} type="number" placeholder="Goal (token amount)" />
              <input value={period} onChange={e => setPeriod(e.target.value)} type="number" placeholder="Period (minutes)" />
              <button className="primary-btn" onClick={createProject}>Create</button>
            </div>
          </section>
          <section>
            <div className="section-header">
              <h2>Projects</h2>
              <button className="secondary-btn" onClick={() => fetchProjects(account)}>Refresh</button>
            </div>
            {projects.map(project => (
              <div key={project.id} className="project-card card">
                <div className="project-title">
                  <h3>Project #{project.id}</h3>
                  <p className="creator">by {project.creator}</p>
                </div>
                <div className="project-details">
                  <div><b>Goal:</b> {project.goal}</div>
                  <div><b>Current:</b> {project.currentAmount}</div>
                  <div><b>Funders:</b> {project.funderCount}</div>
                </div>
                <div className="project-details" style={{"marginBottom": "20px"}}>
                  <div><b>Start:</b> {formatTimestamp(project.startTime)}</div>
                  <div><b>End:</b> {formatTimestamp(project.endTime)}</div>
                </div>
                {account && !sameAddress(account, project.creator) && (
                  <>
                    <div className="actions-grid">
                      <input value={fundAmount[project.id] || ''} onChange={e => setFundAmount(fa => ({ ...fa, [project.id]: e.target.value }))} type="number" placeholder="Fund amount" />
                      <button onClick={() => fundProject(project.id)}>Fund</button>
                      <input value={reduceAmount[project.id] || ''} onChange={e => setReduceAmount(ra => ({ ...ra, [project.id]: e.target.value }))} type="number" placeholder="Reduce Amount" disabled={funderInfo[project.id]?.fundedAmount == 0} />
                      <button onClick={() => reduceFunding(project.id)} disabled={funderInfo[project.id]?.fundedAmount == 0}>Reduce Funding</button>
                    </div>
                    {funderInfo[project.id] && (
                      <pre className="info-block">
                        <p>Your contributions: {ethers.formatUnits(funderInfo[project.id].fundedAmount, 18)}</p>
                        {funderInfo[project.id] && funderInfo[project.id].refunded && <p>You have refunded</p>}
                      </pre>
                    )}
                    <div className="actions-grid">
                      {/*<button onClick={() => claimFunds(project.id)}>Claim</button>*/}
                      {funderInfo[project.id].fundedAmount > 0 && Date.now() > Number(project.endTime) * 1000 && (
                        <button onClick={() => fundingRefund(project.id)}>Funding Refund</button>
                      )}
                      {/*<button onClick={() => developmentRefund(project.id)}>Dev Refund</button>*/}
                    </div>
                  </>
                )}
                <details open={open} onToggle={handleToggle}>
                  <summary
                    style={!canExpand[project.id] ? { color: "#aaa", cursor: "not-allowed" } : {}}
                    onClick={e => {
                      if (!canExpand[project.id]) {
                        e.preventDefault();
                      }
                    }}
                  >
                    Phases & Voting
                  </summary>
                  <div className="actions-grid">
                    <input value={proposalDetail[project.id] || ''} onChange={e => setProposalDetail(pd => ({ ...pd, [project.id]: e.target.value }))} placeholder="Proposal Detail" />
                    <input value={proposalAmount[project.id] || ''} onChange={e => setProposalAmount(pa => ({ ...pa, [project.id]: e.target.value }))} type="number" placeholder="Withdraw Amount" />
                    <button onClick={() => phaseProposal(project.id)}>Phase Proposal</button>
                    <input value={reworkDetail[project.id] || ''} onChange={e => setReworkDetail(rd => ({ ...rd, [project.id]: e.target.value }))} placeholder="Rework Detail" />
                    <input value={reworkAmount[project.id] || ''} onChange={e => setReworkAmount(ra => ({ ...ra, [project.id]: e.target.value }))} type="number" placeholder="Rework Withdraw Amount" />
                    <button onClick={() => reworkProposal(project.id)}>Rework Proposal</button>
                    <input value={improvement[project.id] || ''} onChange={e => setImprovement(im => ({ ...im, [project.id]: e.target.value }))} placeholder="Improvement String" />
                    <button onClick={() => against(project.id)}>Propose Against</button>
                  </div>
                  <div className="actions-grid">
                    <label>Vote Type:</label>
                    <input value={voteType[project.id] || ''} onChange={e => setVoteType(vt => ({ ...vt, [project.id]: e.target.value }))} type="number" placeholder="Vote Type" />
                    <button onClick={() => vote(project.id)}>Vote</button>
                    <input value={delegatee[project.id] || ''} onChange={e => setDelegatee(d => ({ ...d, [project.id]: e.target.value }))} placeholder="Delegatee address" />
                    <button onClick={() => delegate(project.id)}>Delegate</button>
                  </div>
                  <div className="actions-grid">
                    <label>Phase:</label>
                    <input value={phaseInput[project.id] || ''} onChange={e => setPhaseInput(pi => ({ ...pi, [project.id]: e.target.value }))} type="number" placeholder="Phase" />
                    <button onClick={() => getPhase(project.id)}>Get Phase</button>
                  </div>
                  <div className="actions-grid">
                    <label>Get Proposal (rework):</label>
                    <input value={phaseInput[project.id] || ''} onChange={e => setPhaseInput(pi => ({ ...pi, [project.id]: e.target.value }))} type="number" placeholder="Phase" />
                    <input type="checkbox" checked={!!reworkFlag[project.id]} onChange={e => setReworkFlag(rf => ({ ...rf, [project.id]: e.target.checked }))} /> Rework?
                    <button onClick={() => getProposal(project.id)}>Get Proposal</button>
                  </div>
                  <div className="actions-grid">
                    <label>Get Voter (rework):</label>
                    <input value={phaseInput[project.id] || ''} onChange={e => setPhaseInput(pi => ({ ...pi, [project.id]: e.target.value }))} type="number" placeholder="Phase" />
                    <input type="checkbox" checked={!!reworkFlag[project.id]} onChange={e => setReworkFlag(rf => ({ ...rf, [project.id]: e.target.checked }))} /> Rework?
                    <button onClick={() => getVoter(project.id)}>Get My Voter Info</button>
                  </div>
                  <div className="actions-grid">
                    <label>Project State:</label>
                    <button onClick={() => getProjectState(project.id)}>Get State</button>
                  </div>
                  {projectState[project.id] && (
                    <pre className="info-block">{projectState[project.id]}</pre>
                  )}
                </details>
              </div>
            ))}
          </section>
          <section className="card admin-card">
            <h2>Admin</h2>
            <div className="form-row">
              <input value={votingPeriod} onChange={e => setVotingPeriod(e.target.value)} type="number" placeholder="Voting Period" />
              <input value={reworkPeriodInput} onChange={e => setReworkPeriodInput(e.target.value)} type="number" placeholder="Rework Period" />
              <button onClick={setPeriods}>Set Periods</button>
              <button onClick={getReworkPeriod}>Get Rework Period</button>
              <button onClick={getVotingPeriod}>Get Voting Period</button>
              <button onClick={getNextProjectId}>Next Project ID</button>
              <button onClick={getTokenAddress}>Token Address</button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}