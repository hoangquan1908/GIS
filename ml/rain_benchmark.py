"""Reproducible retrospective 3-hour rainfall benchmark. NOT a flood predictor."""
import json
import hashlib
import platform
from pathlib import Path
from datetime import datetime, timezone
import numpy as np
import pandas as pd
import sklearn
import joblib
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error
from threadpoolctl import threadpool_limits

ROOT = Path(__file__).resolve().parents[1]
FEATURES = ['rain_now','rain_lag1','rain_lag2','rain_sum3','rain_sum6','rain_sum12','rain_sum24','temperature','humidity','pressure','hour_sin','hour_cos','year_sin','year_cos']

def load_history():
    frames, provenance = [], []
    for year in range(2020, 2026):
        path = ROOT / 'data' / 'history' / f'era5-{year}.json'
        raw = path.read_bytes()
        obj = json.loads(raw)
        if obj.get('model') != 'era5' or obj.get('utc_offset_seconds') != 25200:
            raise ValueError('Unexpected source model/timezone')
        frame = pd.DataFrame(obj['hourly'])
        frame['time'] = pd.to_datetime(frame['time']).dt.tz_localize('Asia/Bangkok')
        if len(frame) != (8784 if year in (2020,2024) else 8760):
            raise ValueError('Incomplete year')
        frames.append(frame)
        provenance.append({'file':str(path.relative_to(ROOT)).replace('\\','/'),'sha256':hashlib.sha256(raw).hexdigest(),'retrieved_at':obj['retrieved_at']})
    df = pd.concat(frames, ignore_index=True).set_index('time').sort_index()
    if df.index.duplicated().any() or not (df.index.to_series().diff().dropna() == pd.Timedelta(hours=1)).all():
        raise ValueError('Duplicate or missing hours')
    if not np.isfinite(df.to_numpy(dtype=float)).all() or (df.precipitation < 0).any():
        raise ValueError('Missing or invalid features')
    return df, provenance

def make_features(df):
    rain = df.precipitation
    x = pd.DataFrame(index=df.index)
    x['rain_now'] = rain
    for lag in (1,2): x[f'rain_lag{lag}'] = rain.shift(lag)
    for hours in (3,6,12,24): x[f'rain_sum{hours}'] = rain.rolling(hours).sum()
    x['temperature'] = df.temperature_2m
    x['humidity'] = df.relative_humidity_2m
    x['pressure'] = df.surface_pressure
    x['hour_sin'] = np.sin(2*np.pi*x.index.hour/24)
    x['hour_cos'] = np.cos(2*np.pi*x.index.hour/24)
    x['year_sin'] = np.sin(2*np.pi*(x.index.dayofyear-1)/365.25)
    x['year_cos'] = np.cos(2*np.pi*(x.index.dayofyear-1)/365.25)
    # Target contains exactly t+1, t+2, t+3. Rolling features end at t.
    x['target'] = rain.shift(-1)+rain.shift(-2)+rain.shift(-3)
    x['target_end'] = x.index+pd.Timedelta(hours=3)
    return x.dropna()

def split_temporally(frame):
    val_start=pd.Timestamp('2024-01-01',tz='Asia/Bangkok')
    test_start=pd.Timestamp('2025-01-01',tz='Asia/Bangkok')
    train=frame[frame.target_end < val_start]
    val=frame[(frame.index >= val_start)&(frame.target_end < test_start)]
    test=frame[frame.index >= test_start]
    if train.target_end.max() >= val.index.min() or val.target_end.max() >= test.index.min():
        raise ValueError('Label windows overlap chronological split')
    return train,val,test

def evaluate(y, pred):
    y=np.asarray(y);pred=np.asarray(pred)
    wet=y>=1
    heavy=y>=10  # Research threshold for diagnostics, not official warning criteria.
    alarm=pred>=10
    tp=int((heavy&alarm).sum());fn=int((heavy&~alarm).sum());fp=int((~heavy&alarm).sum())
    return {'mae_mm':float(mean_absolute_error(y,pred)),'rmse_mm':float(mean_squared_error(y,pred)**.5),
        'bias_mm':float((pred-y).mean()),'wet_mae_mm':float(mean_absolute_error(y[wet],pred[wet])) if wet.any() else None,
        'wet_samples':int(wet.sum()),'heavy_samples':int(heavy.sum()),
        'heavy_recall':tp/(tp+fn) if tp+fn else None,'heavy_precision':tp/(tp+fp) if tp+fp else None,
        'heavy_threshold_mm_3h':10,'heavy_false_alarms':fp,'heavy_missed':fn}

def bootstrap_daily_gain(frame, model_pred, baseline_pred):
    gains=np.abs(frame.target.to_numpy()-baseline_pred)-np.abs(frame.target.to_numpy()-model_pred)
    daily=pd.Series(gains,index=frame.index).groupby(frame.index.date).agg(['sum','count'])
    rng=np.random.default_rng(42)
    draws=rng.integers(0,len(daily),size=(500,len(daily)))
    sample=daily['sum'].to_numpy()[draws].sum(axis=1)/daily['count'].to_numpy()[draws].sum(axis=1)
    return {'daily_block_bootstrap_repetitions':500,'mae_gain_mm_95pct':[float(x) for x in np.quantile(sample,[.025,.975])],
        'caveat':'Daily blocks approximate serial dependence; storm-level and multi-year validation still needed.'}

def main():
    df,provenance=load_history()
    frame=make_features(df);train,val,test=split_temporally(frame)
    seasonal=train.groupby([train.index.month,train.index.hour]).target.mean()
    def baseline_predictions(part):
        clim=np.array([seasonal.get((t.month,t.hour),train.target.mean()) for t in part.index])
        return {'dry_baseline':np.zeros(len(part)),'persistence_3h':part.rain_sum3.to_numpy(),'seasonal_mean':clim}
    val_pred=baseline_predictions(val);test_pred=baseline_predictions(test);models={}
    with threadpool_limits(limits=2):
        for loss in ['squared_error','poisson']:
            name='hist_gradient_boosting_'+loss
            model=HistGradientBoostingRegressor(loss=loss,max_iter=180,max_leaf_nodes=15,min_samples_leaf=40,learning_rate=.06,l2_regularization=2,early_stopping=False,random_state=42)
            model.fit(train[FEATURES],train.target)
            models[name]=model
            val_pred[name]=np.maximum(0,model.predict(val[FEATURES]))
            test_pred[name]=np.maximum(0,model.predict(test[FEATURES]))
    validation={name:evaluate(val.target,pred) for name,pred in val_pred.items()}
    # Pick algorithm/hyperparameters and comparison baseline exclusively on 2024.
    selected_ai=min(models,key=lambda n:validation[n]['mae_mm'])
    baseline=min(baseline_predictions(val),key=lambda n:validation[n]['mae_mm'])
    selected_overall=min(validation,key=lambda n:validation[n]['mae_mm'])
    metrics={name:evaluate(test.target,pred) for name,pred in test_pred.items()}
    gain=metrics[baseline]['mae_mm']-metrics[selected_ai]['mae_mm']
    report={'schema_version':1,'generated_at':datetime.now(timezone.utc).isoformat(),
        'task':'retrospective_rainfall_next_3h','status':'research_only','flood_model_status':'blocked_missing_verified_labels',
        'target':'Sum of ERA5 precipitation at t+1, t+2, t+3 hours, mm','source_kind':'ERA5 reanalysis, NOT station observations or archived issue-time forecasts',
        'selection_metric':'2024 validation MAE; no tuning on 2025 holdout',
        'selected_ai':selected_ai,'selected_baseline':baseline,'selected_overall':selected_overall,'features':FEATURES,
        'split':{name:{'rows':len(part),'start':part.index.min().isoformat(),'end':part.index.max().isoformat(),'target_end':part.target_end.max().isoformat()} for name,part in [('train',train),('validation',val),('test',test)]},
        'validation_metrics':validation,'test_metrics':metrics,'holdout_mae_gain_vs_baseline_mm':gain,
        'holdout_mae_gain_percent':100*gain/metrics[baseline]['mae_mm'],
        'uncertainty':bootstrap_daily_gain(test,test_pred[selected_ai],test_pred[baseline]),
        'monthly_test':[{'month':int(month),'rows':len(group),**evaluate(group.target,test_pred[selected_ai][test.index.month==month])} for month,group in test.groupby(test.index.month)],
        'provenance':provenance,'software':{'python':platform.python_version(),'numpy':np.__version__,'pandas':pd.__version__,'scikit_learn':sklearn.__version__},
        'limitations':['Model trained on reanalysis available after the event; hindcast experiment, not operational early-warning validation.',
            'No local flood labels; rainfall skill cannot be reported as flood accuracy.',
            'One coarse grid location cannot predict street-level inundation.',
            'No live inference until issue-time data and local observations are validated.',
            'Predictions for overlapping 3h windows are correlated. Single-year holdout is not proof of generalisation.',
            'Selected overall model may be a simple baseline; negative gains must be retained.']}
    out=ROOT/'ml'/'artifacts';out.mkdir(exist_ok=True)
    joblib.dump({'model':models[selected_ai],'features':FEATURES,'task':report['task'],'operational':False},out/'rain-research.joblib')
    pd.DataFrame({'time':test.index,'observed_era5_3h_mm':test.target,'ai_3h_mm':test_pred[selected_ai],'baseline_3h_mm':test_pred[baseline]}).to_csv(out/'rain-holdout-predictions.csv',index=False)
    (ROOT/'data'/'rain-model-report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False,allow_nan=False),encoding='utf8')
    print(json.dumps({'selected_ai':selected_ai,'selected_overall':selected_overall,'test_metrics':metrics,'mae_gain_percent':report['holdout_mae_gain_percent']},indent=2))

if __name__=='__main__': main()
