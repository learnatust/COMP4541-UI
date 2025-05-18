import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import contractAbi from './abi/Crowdfund.json';
import './CrowdfundDapp.css';

// --- FILL THIS IN ---
const CONTRACT_ADDRESS = '0xA1ebbc04b90Bd05D638D5d26aC4f6FBE4c49eaa9';
const TOKEN_ADDRESS = '0x33c5ABE7775F62aB6E20049bbc5d2eb29DEa1B21';

const ERC20_ABI = [
  "function mint(address to, uint256 amount) external",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)"
];

const votingOps = [
  { value: '', label: 'Vote type' },
  { value: 'abstain', label: 'Abstain' },
  { value: 'for', label: 'For' },
  { value: 'against', label: 'Against' },
  { value: 'delegate', label: 'Delegate' }
];

let contract = null;
let tokenContract = null;

  function formatTimestamp(ts) {
    if (!ts || ts === "0") return "-";
    // If ts is in seconds, multiply by 1000 for JS Date
    const date = new Date(Number(ts) * 1000);
    return date.toLocaleString(); // You can use toLocaleDateString() for just the date
  }

  function formatDuration(seconds) {
    seconds = Number(seconds);
    if (isNaN(seconds) || seconds < 0) return "-";

    if (seconds < 60) {
      return `${seconds} sec${seconds !== 1 ? 's' : ''}`;
    } else if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      return `${mins} min${mins !== 1 ? 's' : ''}`;
    } else if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      return `${hours} hour${hours !== 1 ? 's' : ''}`;
    } else {
      const days = Math.floor(seconds / 86400);
      return `${days} day${days !== 1 ? 's' : ''}`;
    }
  }

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

async function mintTokens(address, amount) {
  try {
    const mintTx = await tokenContract.mint(address, amount);
    await mintTx.wait();
  } catch (e) {
    alert(e.shortMessage || e.message); console.error(e);
  }
}

function toVoteType(type) {
  switch (Number(type)) {
    case 0: return "Abstain";
    case 1: return "For";
    case 2: return "Against";
    case 3: return "Delegate";
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
  const [phaseInput, setPhaseInput] = useState({});
  const [reworkFlag, setReworkFlag] = useState({});
  const [funderInfo, setFunderInfo] = useState({});
  const [projectState, setProjectState] = useState({});
  const [votingPeriodInput, setVotingPeriodInput] = useState('');
  const [reworkPeriodInput, setReworkPeriodInput] = useState('');
  const [mintAmountInput, setMintAmountInput] = useState('');
  const [open, setOpen] = useState(false);
  const [selectedVoteOp, setSelectedVoteOp] = useState({});
  const [votingPeriod, setVotingPeriod] = useState('');
  const [reworkPeriod, setReworkPeriod] = useState('');
  const [fetching, setFetching] = useState(false);
  const [txPending, setTxPending] = useState(false);

  const connectingRef = useRef(false);

  function getPhaseStatus(projectState, phase) {
    if (phase.id < projectState.currentPhase) return "- Passed";
    if (phase.proposal.endTime * 1000 > Date.now()) return "- Proposal Voting"
    if (phase.proposal.endTime * 1000 < Date.now()) {
      if (phase.proposal.votes.for >= projectState.threshold) return "- Passed";

      if (Date.now() < (Number(phase.proposal.endTime) + Number(reworkPeriod)) * 1000) {
        if (!phase.proposal.reworked) return "- Waiting for Rework";
        else return "- Rework Voting"
      } 

      if (!phase.proposal.reworked) return "- Terminated";

      if (Number(phase.rework.endTime) * 1000 > Date.now()) return "- Rework Voting"
      if (Number(phase.rework.endTime) * 1000 < Date.now()) {
        if (phase.rework.votes.for >= projectState.threshold) return "- Passed";
        else return "- Terminated";
      }
    }
  }

  function getProjectStatus(project) {
    if (project.endTime * 1000 > Date.now()) return "- Funding";
    if (project.phases.length == 0) {
      if (Number(project.currentAmount) < Number(project.goal)) return "- Terminated";
      else return "- Waiting for Initiation";
    }
    const latestPhase = project.phases[project.phases.length - 1];
    if (latestPhase.status == "- Terminated") return "- Terminated";
    if (latestPhase.status == "- Passed" && Number(project.currentAmount) == 0) return "- Completed";
    return "- Developing";
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
      await getPeriods();
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
    setFetching(true);
    try {
      const nextId = Number(await contract.nextProjectId());
      const arr = [];
      for (let i = 0; i < nextId; i++) {
        let promises = [contract.projects(i), contract.projectState(i)]
        if (funderAddress) promises.push(contract.getFunder(i, funderAddress))
        const res = await Promise.all(promises)
        if (funderAddress) setFunderInfo((prev) => ({ ...prev, [i]: res[2] }));
        const phases = [];
          for (let j = 0; j <= res[1].currentPhase; ++j) {
            promises = [
              contract.getPhase(i, j),
              contract.getProposal(i, j, false)
            ];
            if (funderAddress) promises.push(contract.getVoter(i, j, funderAddress, false))
            let res1 = await Promise.all(promises)
            if (res1[1][0] == 0) continue;
            let phase = {
              id: j,
              withdrawAmount: ethers.formatUnits(res1[0][0], 18),
              proposal: {
                startTime: res1[1][0].toString(),
                endTime: res1[1][1].toString(),
                reworked: res1[1][2],
                detail: res1[1][3],
                improvements: res1[1][4],
                votes: {
                  abstain: res1[1][5][0],
                  for: res1[1][5][1],
                  against: res1[1][5][2]
                },
                voter: funderAddress ? res1[2] : null
              }
            };

            if (res1[1][2]) {
              promises = [contract.getProposal(i, j, true)]
              if (funderAddress) promises.push(contract.getVoter(i, j, funderAddress, true))

              res1 = await Promise.all(promises)
              phase = {
                ...phase, 
                rework: {
                  startTime: res1[0][0].toString(),
                  endTime: res1[0][1].toString(),
                  reworked: res1[0][2],
                  detail: res1[0][3],
                  improvements: res1[0][4],
                  votes: {
                    abstain: res1[0][5][0],
                    for: res1[0][5][1],
                    against: res1[0][5][2]
                  },
                  voter: funderAddress ? res1[1] : null
                }
              };
            } 

            phase.status = getPhaseStatus(res[1], phase);
            phases.push(phase);
          }

        const project = {
          id: i,
          creator: res[0].creator,
          goal: ethers.formatUnits(res[0].goal, 18),
          currentAmount: ethers.formatUnits(res[0].currentAmount, 18),
          funderCount: res[0].funderCount.toString(),
          startTime: res[0].startTime?.toString(),
          endTime: res[0].endTime?.toString(),
          phases,
        };
        arr.push({ ...project, status: getProjectStatus(project) });
        setProjectState((prev) => ({ ...prev, [i]: res[1] }))
      }
      setFetching(false);
      setProjects(arr);
      console.log(arr)
    } catch (e) {
      alert(e.shortMessage || e.message); console.error(e);
    }
  }, []);

  const createProject = async () => {
    if (!goal || !period) return alert('Fill goal and period');
    try {
      setTxPending(true)
      const tx = await contract.createProject(ethers.parseUnits(goal, 18), period);
      await tx.wait();
      setTxPending(false)
      fetchProjects(account);
      setGoal("");
      setPeriod("");
    } catch (e) {
      setTxPending(false)
      alert(e.shortMessage || e.message); console.error(e);
    }
  };

  const fundProject = async (id) => {
    try {
      await checkApproval(account, ethers.parseUnits(fundAmount[id], 18))
      setTxPending(true)
      const tx = await contract.fundProject(id, ethers.parseUnits(fundAmount[id], 18));
      await tx.wait();
      setTxPending(false)
      fetchProjects(account, id);
      setFundAmount(fa => ({ ...fa, [id]: "" }))
    } catch (e) { 
      setTxPending(false)
      alert(e.shortMessage || e.message); console.error(e); 
    }
  };

  const reduceFunding = async (id) => {
    try {
      setTxPending(true)
      const tx = await contract.reduceFunding(id, ethers.parseUnits(reduceAmount[id], 18));
      await tx.wait();
      setTxPending(false)
      fetchProjects(account, id);
      setReduceAmount(ra => ({ ...ra, [id]: "" }))
    } catch (e) { 
      setTxPending(false)
      alert(e.shortMessage || e.message); console.error(e); 
    }
  };

  const claimFunds = async (id) => {
    try {
      setTxPending(true)
      const tx = await contract.claimFunds(id);
      await tx.wait();
      setTxPending(false)
      fetchProjects(account, id);
    } catch (e) { 
      setTxPending(false)
      alert(e.shortMessage || e.message); console.error(e); 
    }
  };

  const refund = async (id) => {
    if (!projectState[id].threshold || projectState[id].threshold == 0) await fundingRefund(id);
    else await developmentRefund(id);
  };

  const fundingRefund = async (id) => {
    try {
      setTxPending(true)
      const tx = await contract.fundingRefund(id);
      await tx.wait();
      setTxPending(false)
      fetchProjects(account, id);
    } catch (e) { 
      setTxPending(false)
      alert(e.shortMessage || e.message); console.error(e); 
    }
  };

  const developmentRefund = async (id) => {
    try {
      setTxPending(true)
      const tx = await contract.developmentRefund(id);
      await tx.wait();
      setTxPending(false)
      fetchProjects(account, id);
    } catch (e) { 
      setTxPending(false)
      alert(e.shortMessage || e.message); console.error(e); 
    }
  };

  const delegate = async (projectId, phaseId) => {
    try {
      setTxPending(true)
      const tx = await contract.delegate(projectId, delegatee[`${projectId}-${phaseId}`]);
      await tx.wait();
      setTxPending(false)
      fetchProjects(account, projectId);
    } catch (e) { 
      setTxPending(false)
      alert(e.shortMessage || e.message); console.error(e); 
    }
  };

  const phaseProposal = async (id) => {
    try {
      setTxPending(true)
      const tx = await contract.phaseProposal(id, ethers.parseUnits(proposalAmount[id] ?? "0", 18), proposalDetail[id] ?? "");
      await tx.wait();
      setTxPending(false)
      fetchProjects(account, id);
    } catch (e) { 
      setTxPending(false)
      alert(e.shortMessage || e.message); console.error(e); 
    }
  };

  const reworkProposal = async (id) => {
    try {
      const withdrawAmount = reworkAmount[id] ? ethers.parseUnits(reworkAmount[id], 18) : ethers.MaxUint256;
      setTxPending(true)
      const tx = await contract.reworkProposal(id, reworkDetail[id] ?? "", withdrawAmount);
      await tx.wait();
      setTxPending(false)
      fetchProjects(account, id);
    } catch (e) { 
      setTxPending(false)
      alert(e.shortMessage || e.message); console.error(e); 
    }
  };

  const against = async (projectId, phaseId) => {
    try {
      setTxPending(true)
      const tx = await contract.against(projectId, improvement[`${projectId}-${phaseId}`] ?? "");
      await tx.wait();
      setTxPending(false)
      fetchProjects(account, projectId);
    } catch (e) { 
      setTxPending(false)
      alert(e.shortMessage || e.message); console.error(e); 
    }
  };

  const vote = async (projectId, phaseId) => {
    try {
      const voteType = selectedVoteOp[`${projectId}-${phaseId}`] == "abstain" ? 
        0 : selectedVoteOp[`${projectId}-${phaseId}`] == "for" ? 
          1 : null;
      setTxPending(true)
      const tx = await contract.vote(projectId, voteType);
      await tx.wait();
      setTxPending(false)
      fetchProjects(account, projectId);
    } catch (e) { 
      setTxPending(false)
      alert(e.shortMessage || e.message); console.error(e); 
    }
  };

  const setPeriods = async () => {
    try {
      setTxPending(true)
      const tx = await contract.setPeriods(votingPeriodInput, reworkPeriodInput);
      await tx.wait();
      setTxPending(false)
      setVotingPeriodInput('');
      setReworkPeriodInput('');
      await getPeriods();
    } catch (e) { 
      setTxPending(false)
      alert(e.shortMessage || e.message); console.error(e); 
    }
  };

  const getPeriods = async () => {
    try {
      const res = await Promise.all([contract.votingPeriod(), contract.reworkPeriod()]);
      setVotingPeriod(res[0])
      setReworkPeriod(res[1])
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
          <section className="card admin-card">
            <h2>Config (Testing only)</h2>
            <div className="project-details">
              <div><b>Vote period:</b> {formatDuration(votingPeriod)}</div>
              <div><b>Rework period:</b> {formatDuration(reworkPeriod)}</div>
            </div>
            <div className="form-row">
              <input value={votingPeriodInput} onChange={e => setVotingPeriodInput(e.target.value)} type="number" placeholder="Voting Period (sec)" />
              <input value={reworkPeriodInput} onChange={e => setReworkPeriodInput(e.target.value)} type="number" placeholder="Rework Period (sec)" />
              <button onClick={setPeriods}>Set Periods</button>
            </div>
            <div className="form-row">
              <input value={mintAmountInput} onChange={e => setMintAmountInput(e.target.value)} type="number" placeholder="Mint Amount" />
              <button onClick={() => {mintTokens(account, ethers.parseUnits(mintAmountInput, 18))}}>Mint Token</button>
            </div>
          </section>
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
              <button
                className="secondary-btn refresh-fixed-btn"
                onClick={() => {fetchProjects(account)}}
                disabled={fetching || txPending}
              >
                {fetching ? (
                  <>
                    <span className="spinner" /> Refreshing...
                  </>
                ) : txPending ? (
                  <>
                    <span className="spinner" /> Sending tx...
                  </>
                ) : "Refresh data"}
              </button>
            </div>
            {projects.map(project => (
              <div key={`project-${project.id}`} className="project-card card">
                <div className="project-title">
                  <h3>Project #{project.id} {project.status}</h3>
                  <p className="creator">by {project.creator}</p>
                </div>
                <div className="project-details">
                  <div><b>Goal:</b> {project.goal}</div>
                  <div><b>Current:</b> {project.currentAmount}</div>
                  {projectState[project.id].totalAmount != 0 && (
                    <div><b>Total amount:</b> {ethers.formatUnits(projectState[project.id].totalAmount, 18)}</div>
                  )}
                  <div><b>Funders:</b> {project.funderCount}</div>
                </div>
                <div className="project-details" style={{"marginBottom": "20px"}}>
                  <div><b>Start:</b> {formatTimestamp(project.startTime)}</div>
                  <div><b>End:</b> {formatTimestamp(project.endTime)}</div>
                </div>
                {account && !sameAddress(account, project.creator) &&  (
                  <>
                    <div className="actions-grid">
                      <input value={fundAmount[project.id] || ''} onChange={e => setFundAmount(fa => ({ ...fa, [project.id]: e.target.value }))} type="number" placeholder="Fund amount" />
                      <button onClick={() => fundProject(project.id)}>Fund</button>
                      <input value={reduceAmount[project.id] || ''} onChange={e => setReduceAmount(ra => ({ ...ra, [project.id]: e.target.value }))} type="number" placeholder="Reduce Amount" />
                      <button onClick={() => reduceFunding(project.id)}>Reduce Funding</button>
                    </div>
                    {funderInfo[project.id] && (
                      <pre className="info-block">
                        <p>Your contribution: {ethers.formatUnits(funderInfo[project.id].fundedAmount, 18)}</p>
                        {funderInfo[project.id] && funderInfo[project.id].refunded && <p>You have refunded</p>}
                      </pre>
                    )}
                    <div className="actions-grid">
                      {!funderInfo[project.id].refunded && (
                        <button onClick={() => refund(project.id)}>Refund</button>
                      )}
                    </div>
                  </>
                )}
                <details>
                  <summary>Phases & Voting</summary>
                  {account && sameAddress(account, project.creator) && (
                    <>
                      <div className="actions-grid">
                        <input value={proposalDetail[project.id] || ''} onChange={e => setProposalDetail(pd => ({ ...pd, [project.id]: e.target.value }))} placeholder="Proposal Detail" />
                        <input value={proposalAmount[project.id] || ''} onChange={e => setProposalAmount(pa => ({ ...pa, [project.id]: e.target.value }))} type="number" placeholder="Withdraw Amount" />
                        <button onClick={() => phaseProposal(project.id)}>Submit Proposal</button>
                      </div>
                      <div className="actions-grid">
                        <input value={reworkDetail[project.id] || ''} onChange={e => setReworkDetail(rd => ({ ...rd, [project.id]: e.target.value }))} placeholder="Rework Detail" />
                        <input value={reworkAmount[project.id] || ''} onChange={e => setReworkAmount(ra => ({ ...ra, [project.id]: e.target.value }))} type="number" placeholder="Rework Withdraw Amount" />
                        <button onClick={() => reworkProposal(project.id)}>Submit Rework</button>
                      </div>
                      <div className="project-details">
                        <div>Leave rework withdraw amount field empty if keep unchanged</div>
                      </div>
                      <div className="actions-grid">
                        <button onClick={() => claimFunds(project.id)}>Claim funds</button>
                      </div>
                    </>
                  )}

                  {project.phases.length > 0 ? (
                    <>
                      {project.phases.map(phase => (
                        <div key={`phase-${project.id}-${phase.id}`} className="card" style={{ marginTop: "15px" }}>
                          <div className="project-title"><h3>Phase #{phase.id} {phase.status}</h3></div>
                          <div className="project-details">
                            <div><b>Description:</b> {phase.proposal.detail}</div>
                          </div>
                          {phase.proposal.reworked && (
                            <div className="project-details">
                              <div><b>Rework description:</b> {phase.rework.detail}</div>
                            </div>
                          )}
                          <div className="project-details">
                            <div><b>Withdraw amount:</b> {phase.withdrawAmount}</div>
                            <div><b>Rework:</b> {phase.proposal.reworked ? "Yes" : "No"}</div>
                          </div>
                          <div className="project-details">
                            <div><b>Start:</b> {formatTimestamp(phase.proposal.startTime)}</div>
                            <div><b>End:</b> {formatTimestamp(phase.proposal.reworked ? phase.rework.endTime : phase.proposal.endTime)}</div>
                          </div>
                          <div className="project-details">
                            <b>Proposal:</b>
                            <div>For - {projectState[project.id].totalAmount == 0 ? 0 : (Number(phase.proposal.votes.for) * 100 / Number(projectState[project.id].totalAmount)).toFixed(2)}%</div>
                            <div>Against - {projectState[project.id].totalAmount == 0 ? 0 : (Number(phase.proposal.votes.against) * 100 / Number(projectState[project.id].totalAmount)).toFixed(2)}%</div>
                          </div>
                          {phase.proposal.reworked && (
                            <div className="project-details" style={{"marginBottom": "20px"}}>
                              <b>Rework:</b>
                              <div>For - {projectState[project.id].totalAmount == 0 ? 0 : (Number(phase.rework.votes.for) * 100 / Number(projectState[project.id].totalAmount)).toFixed(2)}%</div>
                              <div>Against - {projectState[project.id].totalAmount == 0 ? 0 : (Number(phase.rework.votes.against) * 100 / Number(projectState[project.id].totalAmount)).toFixed(2)}%</div>
                            </div>
                          )}
                          {account && !sameAddress(account, project.creator) && funderInfo[project.id].hasFunded && (
                            <>
                              {!phase.proposal.voter.voted || phase.proposal.reworked && !phase.rework.voter.voted ? (
                                <div className="actions-grid">
                                  Vote:
                                  <select
                                    className="styled-select"
                                    value={selectedVoteOp[`${project.id}-${phase.id}`] || ''}
                                    onChange={e => setSelectedVoteOp(op => ({ ...op, [`${project.id}-${phase.id}`]: e.target.value }))}
                                  >
                                    {votingOps.map(op => (
                                      <option key={op.value} value={op.value}>{op.label}</option>
                                    ))}
                                  </select>
                                  {(selectedVoteOp[`${project.id}-${phase.id}`] === "abstain" || selectedVoteOp[`${project.id}-${phase.id}`] === "for") && (
                                    <>
                                      <button onClick={() => vote(project.id, phase.id)}>Vote</button>
                                    </>
                                  )}
                                  {selectedVoteOp[`${project.id}-${phase.id}`] === "against" && (
                                    <>
                                      {!phase.proposal.reworked && (
                                        <input
                                          value={improvement[`${project.id}-${phase.id}`] || ''}
                                          onChange={e => setImprovement(im => ({ ...im, [`${project.id}-${phase.id}`]: e.target.value }))}
                                          placeholder="Improvement advice"
                                        />
                                      )}
                                      <button onClick={() => against(project.id, phase.id)}>Vote</button>
                                    </>
                                  )}
                                  {selectedVoteOp[`${project.id}-${phase.id}`] === "delegate" && (
                                    <>
                                      <input
                                        value={delegatee[`${project.id}-${phase.id}`] || ''}
                                        onChange={e => setDelegatee(d => ({ ...d, [`${project.id}-${phase.id}`]: e.target.value }))}
                                        placeholder="Delegatee address"
                                      />
                                      <button onClick={() => delegate(project.id, phase.id)}>Delegate</button>
                                    </>
                                  )}
                                </div> 
                              ) : (
                                <pre className="info-block">
                                  {phase.proposal.reworked ? (
                                    <>
                                      <p>Proposal Vote: {toVoteType(phase.proposal.voter.voteType)} {phase.proposal.voter.voteType == 3 ? `to ${phase.proposal.voter.delegatee}` : ""}</p>
                                      <p>Rework Vote: {toVoteType(phase.rework.voter.voteType)} {phase.rework.voter.voteType == 3 ? `to ${phase.rework.voter.delegatee}` : ""}</p>
                                    </>
                                  ) : (
                                    <p>Proposal Vote: {toVoteType(phase.proposal.voter.voteType)} {phase.proposal.voter.voteType == 3 ? `to ${phase.proposal.voter.delegatee}` : ""}</p>
                                  )}
                                </pre>
                              )}
                            </>
                          )}
                          {phase.proposal.improvements.length > 0 && (
                            <div className="actions-grid">
                              <details>
                                <summary>Improvement advice</summary>
                                {phase.proposal.improvements.map((improvement, index) => (
                                  <div key={`$improvement-${project.id}-${phase.id}-${index}`}>
                                    {improvement && (
                                      <pre className="info-block">
                                        <p><b>{index + 1}.</b> {improvement}</p>
                                      </pre>
                                    )}
                                  </div>
                                ))}
                              </details>
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  ) : <div className="project-details">Waiting for project initiation</div>}
                </details>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}