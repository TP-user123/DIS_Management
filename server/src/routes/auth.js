import { Router } from 'express';
import bcrypt from 'bcryptjs'; import jwt from 'jsonwebtoken'; import crypto from 'node:crypto'; import nodemailer from 'nodemailer';
import { Company, User } from '../models.js'; import { auth, asyncHandler, DEFAULT_ROLE_PERMISSIONS } from '../middleware.js';
const router=Router(); const tokenFor=u=>jwt.sign({userId:u._id},process.env.JWT_SECRET,{expiresIn:'12h'});
const publicUser=(u,company=null)=>({id:u._id,name:u.name,email:u.email,role:u.role,team:u.team,shift:u.shift,companyId:u.companyId,tempPasswordChangeRequired:!!u.tempPasswordChangeRequired,status:u.status,permissions:u.role==='MANAGER'?DEFAULT_ROLE_PERMISSIONS.MANAGER:(Array.isArray(company?.rolePermissions?.[u.role])?company.rolePermissions[u.role]:(DEFAULT_ROLE_PERMISSIONS[u.role]||[]))});
router.post('/login',asyncHandler(async(req,res)=>{const email=req.body.email?.trim().toLowerCase();const password=req.body.password||'';const user=await User.findOne({email,status:'active'});if(!user||!(await bcrypt.compare(password,user.passwordHash)))return res.status(401).json({message:'Invalid email or password.'});const company=await Company.findById(user.companyId);if(!company||company.status!=='active')return res.status(403).json({message:'TCS workspace is unavailable.'});user.lastLoginAt=new Date();await user.save();res.json({token:tokenFor(user),user:publicUser(user,company),company:{id:company._id,name:company.name||'TCS'}})}));

router.post('/forgot-password',asyncHandler(async(req,res)=>{
 const email=String(req.body.email||'').trim().toLowerCase();if(!email)return res.status(400).json({message:'Enter your work email address.'});
 const generic={message:'If an active account exists for this email, password reset instructions have been prepared.'};
 const user=await User.findOne({email,status:'active'});if(!user)return res.json(generic);
 const token=crypto.randomBytes(32).toString('hex');user.resetTokenHash=crypto.createHash('sha256').update(token).digest('hex');user.resetTokenExpiresAt=new Date(Date.now()+30*60*1000);await user.save();
 const resetUrl=`${process.env.CLIENT_URL||'http://localhost:5173'}/auth/reset-password?token=${token}`;
 if(process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASS&&process.env.SMTP_FROM){const transporter=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:String(process.env.SMTP_SECURE||'false')==='true',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});await transporter.sendMail({from:process.env.SMTP_FROM,to:user.email,subject:'OpsDesk password reset',text:`Use this link to reset your password. It expires in 30 minutes: ${resetUrl}`});return res.json(generic);}
 if(process.env.NODE_ENV==='production')return res.json(generic);console.log(`[OpsDesk local password reset] ${user.email}: ${resetUrl}`);res.json({...generic,developmentResetUrl:resetUrl,developmentNote:'SMTP is not configured; this reset link is for local development only.'});
}));
router.post('/reset-password',asyncHandler(async(req,res)=>{const token=String(req.body.token||''),password=String(req.body.password||'');if(password.length<10)return res.status(400).json({message:'Password must contain at least 10 characters.'});if(!token)return res.status(400).json({message:'Reset token is missing.'});const tokenHash=crypto.createHash('sha256').update(token).digest('hex');const user=await User.findOne({resetTokenHash:tokenHash,resetTokenExpiresAt:{$gt:new Date()},status:'active'});if(!user)return res.status(400).json({message:'This password reset link is invalid or expired. Request a new one.'});user.passwordHash=await bcrypt.hash(password,12);user.tempPasswordChangeRequired=false;user.resetTokenHash=null;user.resetTokenExpiresAt=null;await user.save();res.json({message:'Password reset successfully. You can now sign in.'});}));
router.get('/me',auth,asyncHandler(async(req,res)=>{const company=await Company.findById(req.companyId);res.json({user:publicUser(req.user,company),company:company?{id:company._id,name:company.name||'TCS'}:{name:'TCS'}})}));
router.patch('/profile',auth,asyncHandler(async(req,res)=>{const {name,team,shift}=req.body;if(name!==undefined){if(!name.trim())return res.status(400).json({message:'Name cannot be empty.'});req.user.name=name.trim()}if(req.user.role==='MANAGER'&&team!==undefined)req.user.team=String(team).trim();if(req.user.role==='MANAGER'&&shift!==undefined)req.user.shift=String(shift).trim();await req.user.save();const company=await Company.findById(req.companyId);res.json({user:publicUser(req.user,company)})}));
router.post('/change-password',auth,asyncHandler(async(req,res)=>{
  const current=req.body.currentPassword||'';
  const next=req.body.newPassword||'';
  if(next.length<10)return res.status(400).json({message:'New password must contain at least 10 characters.'});

  // The auth middleware intentionally excludes passwordHash from req.user.
  // Load a fresh user document here so password comparisons use the stored hash.
  const account=await User.findOne({_id:req.user._id,companyId:req.companyId,status:'active'});
  if(!account || !account.passwordHash)return res.status(400).json({message:'Account password is not configured. Ask the manager to reset your password.'});

  if(!account.tempPasswordChangeRequired && !(await bcrypt.compare(current,account.passwordHash)))
    return res.status(400).json({message:'Current password is incorrect.'});
  if(await bcrypt.compare(next,account.passwordHash))
    return res.status(400).json({message:'Choose a password different from your temporary password.'});

  account.passwordHash=await bcrypt.hash(next,12);
  account.tempPasswordChangeRequired=false;
  await account.save();
  const company=await Company.findById(req.companyId);res.json({message:'Password changed successfully.',user:publicUser(account,company)});
}));
export default router;
