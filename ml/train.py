"""Issue-time flood model pipeline; refuses unverified labels. See ml/README.md."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import pandas as pd
import joblib
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import average_precision_score,roc_auc_score,brier_score_loss,precision_recall_fscore_support,fbeta_score,confusion_matrix
from flood_data import FEATURES,validate_observations,split_events

def logit(prob):
    p=np.clip(prob,1e-6,1-1e-6)
    return np.log(p/(1-p)).reshape(-1,1)

def metrics(y,p,threshold):
    pred=p>=threshold
    precision,recall,f1,_=precision_recall_fscore_support(y,pred,average='binary',zero_division=0)
    return {'average_precision':float(average_precision_score(y,p)),'roc_auc':float(roc_auc_score(y,p)),
        'brier_score':float(brier_score_loss(y,p)),'precision':float(precision),'recall':float(recall),'f1':float(f1),
        'f2':float(fbeta_score(y,pred,beta=2,zero_division=0)),'confusion_matrix_labels':[0,1],'confusion_matrix':confusion_matrix(y,pred,labels=[0,1]).tolist()}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('csv')
    parser.add_argument('--depth-threshold-cm',type=float,default=10)
    args=parser.parse_args()
    source=Path(args.csv)
    df=validate_observations(pd.read_csv(source),args.depth_threshold_cm)
    train,val,test=split_events(df)
    candidates={'random_forest':RandomForestClassifier(n_estimators=300,max_depth=12,min_samples_leaf=5,class_weight='balanced',n_jobs=2,random_state=42),
        'logistic_regression':make_pipeline(StandardScaler(),LogisticRegression(class_weight='balanced',max_iter=2000,random_state=42))}
    validation={}
    for name,model in candidates.items():
        model.fit(train[FEATURES],train.flooded)
        validation[name]=float(average_precision_score(val.flooded,model.predict_proba(val[FEATURES])[:,1]))
    selected=max(validation,key=validation.get);model=candidates[selected]
    # Independent chronological calibration partition; holdout remains untouched.
    raw_val=model.predict_proba(val[FEATURES])[:,1]
    calibrator=LogisticRegression(C=1,random_state=42).fit(logit(raw_val),val.flooded)
    val_p=calibrator.predict_proba(logit(raw_val))[:,1]
    thresholds=np.linspace(.05,.95,91)
    threshold=float(max(thresholds,key=lambda t:fbeta_score(val.flooded,val_p>=t,beta=2,zero_division=0)))
    raw_test=model.predict_proba(test[FEATURES])[:,1]
    test_p=calibrator.predict_proba(logit(raw_test))[:,1]
    baseline=np.full(len(test),train.flooded.mean())
    report={'status':'research_evaluation_not_approved_for_operations','task':'flood_at_fixed_future_horizon','horizon_hours':int(df.horizon_hours.iloc[0]),
        'depth_threshold_cm':args.depth_threshold_cm,'threshold_status':'Research definition, not official warning criterion',
        'selected_model':selected,'features':FEATURES,'validation_average_precision':validation,'decision_threshold':threshold,
        'threshold_selection':'Maximise F2 on calibration partition only; exploratory, not authority-approved',
        'test_calibrated':metrics(test.flooded,test_p,threshold),'test_uncalibrated':metrics(test.flooded,raw_test,.5),
        'test_prior_baseline':metrics(test.flooded,baseline,.5),
        'split':{name:{'rows':len(part),'events':list(map(str,part.event_id.unique())),'positive_rows':int(part.flooded.sum()),'issued_start':part.issued_at.min().isoformat(),'target_end':part.target_at.max().isoformat()} for name,part in zip(['train','calibration','test'],[train,val,test])},
        'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'sklearn_version':sklearn.__version__,
        'limitations':['Metadata verification flags require a human source audit; software cannot certify truth.',
            'Model choice, sigmoid calibration and threshold use same validation set; only final holdout metrics are evaluation.',
            'Unseen-location spatial validation and prospective testing still required.',
            'No automatic promotion to website or public upload of observations.']}
    out=Path(__file__).parent/'artifacts';out.mkdir(exist_ok=True)
    joblib.dump({'model':model,'calibrator':calibrator,'threshold':threshold,'features':FEATURES,'horizon_hours':report['horizon_hours'],'operational':False},out/'flood-model.joblib')
    (out/'evaluation.json').write_text(json.dumps(report,indent=2,ensure_ascii=False,allow_nan=False),encoding='utf8')
    print(json.dumps(report,indent=2,ensure_ascii=False))
if __name__=='__main__':main()
